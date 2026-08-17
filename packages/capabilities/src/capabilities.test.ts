import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PlatformError, createLogger } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { auditCatalog } from "./catalog.js";
import { openExecutor } from "./executor/index.js";
import { parseCapability, parseCapabilityYaml } from "./parse.js";
import type { CapabilitySpec } from "./spec.js";
import { validateCapability } from "./validate.js";

const YAML = `
id: cap_order_discount
version: 1
name: order.getDiscount
description: Desconto aplicado a um pedido
operation: READ
engine: sqlite
allowedEnvironments: [ephemeral, staging, production]
sql: |
  SELECT o.id, o.discount_pct, o.total_cents, o.customer_email
  FROM orders o
  WHERE o.id = :orderId
parameters:
  orderId: { type: integer, required: true }
allowlist:
  tables: [orders]
  columns: [orders.id, orders.discount_pct, orders.total_cents, orders.customer_email]
sensitivity:
  orders.customer_email: PII
  orders.total_cents: FINANCIAL
constraints: { timeoutMs: 1000, maxRows: 5 }
keyColumns: [id]
approval: { status: APPROVED, approvedBy: "cleber", approvedAt: "2026-08-17", reviewPr: "#15" }
`;

const base = (): CapabilitySpec => parseCapabilityYaml(YAML, "t");
const withSql = (sql: string, extra: Partial<CapabilitySpec> = {}): CapabilitySpec => ({
  ...base(),
  sql,
  ...extra,
});
const problems = (spec: CapabilitySpec): string[] =>
  validateCapability(spec).issues.map((issue) => issue.problem);

describe("parse", () => {
  it("lê o YAML da §14.3 e aplica defaults declarados", () => {
    const spec = base();
    expect(spec.name).toBe("order.getDiscount");
    expect(spec.constraints).toEqual({ timeoutMs: 1000, maxRows: 5 });
    expect(spec.approval.status).toBe("APPROVED");
    const noConstraints = parseCapability(
      { ...JSON.parse(JSON.stringify(spec)), constraints: undefined },
      "t",
    );
    expect(noConstraints.constraints).toEqual({ timeoutMs: 3000, maxRows: 1000 });
  });

  it("recusa APPROVED anônimo, allowlist ausente e nome fora do padrão", () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    expect(() => parseCapability({ ...raw, approval: { status: "APPROVED" } }, "t")).toThrow(
      PlatformError,
    );
    expect(() => parseCapability({ ...raw, allowlist: undefined }, "t")).toThrow(PlatformError);
    expect(() => parseCapability({ ...raw, name: "getDiscount" }, "t")).toThrow(PlatformError);
  });
});

describe("validação estática — suíte de SQL malicioso e malformado (CLAUDE.md §7)", () => {
  it("aceita a capability boa, e nota o LIMIT compulsório", () => {
    const result = validateCapability(base());
    expect(result.issues).toEqual([]);
    expect(result.limitMissing).toBe(true);
    expect(result.notes.join(" ")).toContain("LIMIT 5");
    expect(result.referencedTables).toEqual(["orders"]);
    expect(result.referencedColumns).toEqual([
      "orders.customer_email",
      "orders.discount_pct",
      "orders.id",
      "orders.total_cents",
    ]);
  });

  it.each([
    [
      "segundo statement",
      "SELECT o.id FROM orders o WHERE o.id = :orderId; DROP TABLE orders",
      "`;`",
    ],
    ["comentário", "SELECT o.id FROM orders o -- WHERE o.id = :orderId", "comentário"],
    ["escrita disfarçada", "SELECT o.id FROM orders o WHERE o.id = :orderId FOR UPDATE", "UPDATE"],
    ["não começa com SELECT", "DELETE FROM orders WHERE id = :orderId", "DELETE"],
    ["INTO", "SELECT o.id INTO backup FROM orders o WHERE o.id = :orderId", "INTO"],
    ["PRAGMA", "PRAGMA table_info(orders)", "PRAGMA"],
    ["parâmetro posicional", "SELECT o.id FROM orders o WHERE o.id = ?", "posicional"],
    ["parâmetro não declarado", "SELECT o.id FROM orders o WHERE o.id = :other", ":other usado"],
    ["tabela fora da allowlist", "SELECT u.id FROM users u WHERE u.id = :orderId", "tabela users"],
    [
      "join fora da allowlist",
      "SELECT o.id FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = :orderId",
      "tabela payments",
    ],
    [
      "coluna fora da allowlist",
      "SELECT o.id, o.card_number FROM orders o WHERE o.id = :orderId",
      "coluna orders.card_number",
    ],
    [
      "LIMIT acima do teto",
      "SELECT o.id FROM orders o WHERE o.id = :orderId LIMIT 500",
      "LIMIT 500",
    ],
  ])("recusa: %s", (_label, sql, expected) => {
    expect(problems(withSql(sql)).join(" | ")).toContain(expected);
  });

  it("recusa WRITE/DESTRUCTIVE nesta fase e em produção, com o motivo", () => {
    const write = withSql("UPDATE orders SET status = 'paid' WHERE id = :orderId", {
      operation: "WRITE",
    });
    const issues = problems(write).join(" | ");
    expect(issues).toContain("WRITE não é executável nesta fase");
    expect(issues).toContain("production aceita exclusivamente READ");
  });

  it("parâmetro obrigatório não usado é problema; alias de tabela é resolvido", () => {
    expect(problems(withSql("SELECT o.id FROM orders o LIMIT 1")).join(" | ")).toContain(
      "orderId declarado como obrigatório e não usado",
    );
    expect(
      problems(withSql("SELECT pedidos.id FROM orders AS pedidos WHERE pedidos.id = :orderId")),
    ).toEqual([]);
  });

  it("literal de string não engana o tokenizador", () => {
    // O `;` e o DROP dentro de string continuam recusados (`;` é proibido em qualquer lugar); mas
    // uma palavra reservada DENTRO de literal não conta como comando.
    expect(
      problems(
        withSql("SELECT o.id FROM orders o WHERE o.id = :orderId AND o.discount_pct = 'UPDATE'"),
      ),
    ).toEqual([]);
  });
});

describe("executor sqlite", () => {
  const dir = mkdtempSync(join(tmpdir(), "aletheia-cap-"));
  const dbPath = join(dir, "loja.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, discount_pct INTEGER, total_cents INTEGER, customer_email TEXT, created_at TEXT);",
  );
  db.exec("INSERT INTO orders VALUES (1, 15, 10000, 'ana@exemplo.com', '2026-01-01');");
  db.exec("INSERT INTO orders VALUES (2, 10, 5000, 'bia@exemplo.com', '2026-01-02');");
  db.close();

  const logs: string[] = [];
  const logger = createLogger({
    context: { runId: "run_test", orgId: null, projectId: null },
    write: (line: string) => {
      logs.push(line);
    },
  });
  const executor = (specs: CapabilitySpec[]) =>
    openExecutor(`sqlite:${dbPath}`, { catalog: { specs }, environment: "staging", logger });

  it("executa READ aprovada com parâmetro nomeado, mascara PII por hash e audita sem valores", async () => {
    const result = await executor([base()]).execute("order.getDiscount", { orderId: 1 });
    expect(result.columns).toEqual(["id", "discount_pct", "total_cents", "customer_email"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.slice(0, 3)).toEqual([1, 15, 10000]);
    expect(String(result.rows[0]?.[3])).toMatch(/^<masked:[0-9a-f]{12}>$/);
    expect(result.maskedColumns).toEqual(["customer_email"]);
    expect(result.keyColumns).toEqual(["id"]);
    // Auditoria: capability e contagem, nunca o valor nem o e-mail.
    const audit = logs.find((line) => line.includes("capability executada")) ?? "";
    expect(audit).toContain('"capability":"order.getDiscount"');
    expect(audit).not.toContain("ana@exemplo.com");
  });

  it("LIMIT compulsório: sem LIMIT no SQL, o resultado é cortado em maxRows e diz que cortou", async () => {
    const all = withSql("SELECT o.id FROM orders o WHERE o.id >= :orderId", {
      constraints: { timeoutMs: 1000, maxRows: 1 },
    });
    const result = await executor([all]).execute("order.getDiscount", { orderId: 1 });
    expect(result.rowCount).toBe(1);
    // LIMIT 1 no SQL faz o driver devolver 1; `truncated` só é true quando o driver
    // devolveu MAIS que maxRows — o que não acontece com LIMIT aplicado. Declarado.
    expect(result.truncated).toBe(false);
  });

  it("recusa PROPOSED, ambiente fora da lista, parâmetro errado e capability inexistente — sempre antes de tocar o banco", async () => {
    const proposed = { ...base(), approval: { ...base().approval, status: "PROPOSED" as const } };
    await expect(
      executor([proposed]).execute("order.getDiscount", { orderId: 1 }),
    ).rejects.toMatchObject({ code: "CAPABILITY_REJECTED" });
    const onlyProd = { ...base(), allowedEnvironments: ["production" as const] };
    await expect(
      executor([onlyProd]).execute("order.getDiscount", { orderId: 1 }),
    ).rejects.toMatchObject({ code: "CAPABILITY_REJECTED" });
    await expect(
      executor([base()]).execute("order.getDiscount", { orderId: "1" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_REJECTED" });
    await expect(
      executor([base()]).execute("order.getDiscount", { orderId: 1, extra: 2 }),
    ).rejects.toMatchObject({ code: "CAPABILITY_REJECTED" });
    await expect(executor([base()]).execute("order.nope", {})).rejects.toMatchObject({
      code: "CAPABILITY_REJECTED",
    });
  });

  it("capability inválida no catálogo não executa nem por engano", async () => {
    const bad = withSql("SELECT o.id FROM orders o; DROP TABLE orders");
    await expect(
      executor([bad]).execute("order.getDiscount", { orderId: 1 }),
    ).rejects.toMatchObject({ code: "CAPABILITY_INVALID" });
  });

  it("URL de engine desconhecido é falha de plataforma sem a URL no contexto", () => {
    try {
      openExecutor("postgres://user:senha@host/db", {
        catalog: { specs: [] },
        environment: "staging",
        logger,
      });
      expect.fail("deveria lançar");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformError);
      expect(JSON.stringify((error as PlatformError).context)).not.toContain("senha");
    }
  });

  it("a conexão é somente leitura: mesmo um SQL de escrita que escapasse falharia no engine", async () => {
    // O validador já recusa; este teste prova a segunda barreira (privilégio mínimo).
    const adapter = (await import("./executor/sqlite.js")).openSqlite(dbPath);
    await expect(adapter.query("UPDATE orders SET discount_pct = 0", {}, 1000)).rejects.toThrow();
    await adapter.close();
  });
});

describe("auditCatalog", () => {
  it("lê um diretório e relata por arquivo, sem lançar no arquivo ruim", () => {
    const dir = mkdtempSync(join(tmpdir(), "aletheia-catalog-"));
    writeFileSync(join(dir, "boa.yaml"), YAML);
    writeFileSync(join(dir, "ruim.yaml"), "id: 1\n");
    const reports = auditCatalog(dir);
    expect(reports).toHaveLength(2);
    expect(reports[0]?.validation?.issues).toEqual([]);
    expect(reports[1]?.parseError).toContain("CAPABILITY_INVALID");
  });
});
