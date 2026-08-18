import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createLogger } from "@aletheia/shared";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { parseCapabilityYaml } from "../parse.js";

import { provisionEphemeralDatabase } from "./isolation.js";
import { positional } from "./postgres.js";

import { openExecutor } from "./index.js";

const logger = createLogger({
  context: { runId: "run_test", orgId: null, projectId: null },
  write: () => {},
});

const YAML = (engine: string) => `
id: cap_order_discount
version: 1
name: order.getDiscount
description: desconto do pedido
operation: READ
engine: ${engine}
allowedEnvironments: [ephemeral, staging]
sql: |
  SELECT o.id, o.discount_pct FROM orders o WHERE o.id = :orderId
parameters:
  orderId: { type: integer, required: true }
allowlist:
  tables: [orders]
  columns: [orders.id, orders.discount_pct]
keyColumns: [id]
approval: { status: APPROVED, approvedBy: "cleber" }
`;

describe("template-clone — sqlite", () => {
  it("clona o arquivo, a execução lê o clone, o descarte apaga o clone e preserva o template", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aletheia-tpl-"));
    const template = join(dir, "template.db");
    const db = new DatabaseSync(template);
    db.exec(
      "CREATE TABLE orders (id INTEGER PRIMARY KEY, discount_pct INTEGER); INSERT INTO orders VALUES (42, 15);",
    );
    db.close();

    const clone = await provisionEphemeralDatabase(`sqlite:${template}`, {
      strategy: "template-clone",
      runId: "run_abc",
      logger,
    });
    expect(clone.strategy).toBe("template-clone");
    expect(clone.url).not.toBe(`sqlite:${template}`);
    const clonePath = clone.url.slice("sqlite:".length);
    expect(existsSync(clonePath)).toBe(true);

    const executor = openExecutor(clone.url, {
      catalog: { specs: [parseCapabilityYaml(YAML("sqlite"), "t")] },
      environment: "ephemeral",
      logger,
    });
    const result = await executor.execute("order.getDiscount", { orderId: 42 });
    expect(result.rows).toEqual([[42, 15]]);
    await executor.close();

    await clone.dispose();
    expect(existsSync(clonePath)).toBe(false);
    expect(existsSync(template)).toBe(true);
  });

  it("shared-degraded devolve a própria URL e não descarta nada", async () => {
    const shared = await provisionEphemeralDatabase("sqlite:/x.db", {
      strategy: "shared-degraded",
      runId: "r",
      logger,
    });
    expect(shared).toMatchObject({ url: "sqlite:/x.db", strategy: "shared-degraded" });
    await shared.dispose();
  });

  it("estratégia não suportada e engine desconhecido são falha de plataforma", async () => {
    await expect(
      provisionEphemeralDatabase("sqlite:/x.db", { strategy: "partition", runId: "r", logger }),
    ).rejects.toMatchObject({ code: "DATABASE_UNREACHABLE" });
    await expect(
      provisionEphemeralDatabase("mysql://x/y", { strategy: "template-clone", runId: "r", logger }),
    ).rejects.toMatchObject({ code: "DATABASE_UNREACHABLE" });
  });
});

describe("postgres — :nome → $n", () => {
  it("converte na ordem de primeira ocorrência e repete o índice para o mesmo nome", () => {
    expect(
      positional("SELECT * FROM t WHERE a = :x AND b = :y AND c = :x", { x: 1, y: "b" }),
    ).toEqual({
      text: "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $1",
      values: [1, "b"],
    });
  });
});

/**
 * Contra um PostgreSQL de verdade — só quando `ALETHEIA_PG_URL` aponta para um
 * (no CI é o serviço do job; localmente, `docker run … postgres`). Sem ele, os
 * casos abaixo são PULADOS e o motivo aparece: não fingimos que passaram.
 */
const PG_URL = process.env["ALETHEIA_PG_URL"] ?? "";
const pgIt = PG_URL.length > 0 ? it : it.skip;

describe(`postgres — adaptador e template-clone${PG_URL.length > 0 ? "" : " (PULADO: ALETHEIA_PG_URL ausente)"}`, () => {
  pgIt(
    "cria o template, clona por CREATE DATABASE … TEMPLATE, lê pelo clone em READ ONLY, e descarta",
    async () => {
      // Prepara o TEMPLATE num banco próprio, com uma conexão que fecha antes do
      // clone (o engine exige template sem conexões ativas).
      const admin = new URL(PG_URL);
      admin.pathname = "/postgres";
      const templateName = `aletheia_tpl_${Date.now().toString(36)}`;
      const setup = new pg.Client({ connectionString: admin.toString() });
      await setup.connect();
      await setup.query(`CREATE DATABASE "${templateName}"`);
      await setup.end();
      const templateUrl = new URL(PG_URL);
      templateUrl.pathname = `/${templateName}`;
      const seed = new pg.Client({ connectionString: templateUrl.toString() });
      await seed.connect();
      await seed.query("CREATE TABLE orders (id INTEGER PRIMARY KEY, discount_pct INTEGER)");
      await seed.query("INSERT INTO orders VALUES (42, 15)");
      await seed.end();

      const clone = await provisionEphemeralDatabase(templateUrl.toString(), {
        strategy: "template-clone",
        runId: `run_${Date.now().toString(36)}`,
        logger,
      });
      expect(clone.url).toContain(clone.name);

      const executor = openExecutor(clone.url, {
        catalog: { specs: [parseCapabilityYaml(YAML("postgresql"), "t")] },
        environment: "ephemeral",
        logger,
      });
      const result = await executor.execute("order.getDiscount", { orderId: 42 });
      expect(result.rows).toEqual([[42, 15]]);
      // Segunda barreira: a transação é READ ONLY no engine.
      const { openPostgres } = await import("./postgres.js");
      const raw = openPostgres(clone.url);
      await expect(raw.query("UPDATE orders SET discount_pct = 0", {}, 1000)).rejects.toThrow(
        /read-only/i,
      );
      await raw.close();
      await executor.close();

      await clone.dispose();
      const check = new pg.Client({ connectionString: admin.toString() });
      await check.connect();
      const gone = await check.query("SELECT 1 FROM pg_database WHERE datname = $1", [clone.name]);
      expect(gone.rowCount).toBe(0);
      await check.query(`DROP DATABASE IF EXISTS "${templateName}"`);
      await check.end();
    },
    60_000,
  );
});
