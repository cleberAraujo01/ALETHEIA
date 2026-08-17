import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { IR_VERSION, type IrJourney, type IrStep, type Target } from "@aletheia/ir";
import type { ElementRepository } from "@aletheia/selector-engine";
import { PlatformError, createLogger, systemClock } from "@aletheia/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { capture } from "./capture.js";

/**
 * Teste de ponta a ponta do interpretador: browser de verdade, servidor HTTP
 * local, fixture estático. Não há `sleep`: a convergência é a do runner.
 */

const SITE = new URL("../__fixtures__/site/", import.meta.url);
const SECRET = "s3nh4-que-nao-pode-vazar";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    try {
      const body = await readFile(new URL(file, SITE));
      response.writeHead(200, {
        "content-type": extname(file) === ".html" ? "text/html; charset=utf-8" : "text/plain",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("nao encontrado");
    }
  };
  server = createServer((request, response) => {
    void serve(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new PlatformError("INTERNAL_INVARIANT_BROKEN", {
      reason: "servidor de fixture sem porta",
    });
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const journey = (steps: readonly IrStep[]): IrJourney => ({
  irVersion: IR_VERSION,
  id: "jr_fixture",
  name: "fixture",
  viewport: { width: 800, height: 600 },
  steps,
});

const options = (ir: IrJourney, elements: ElementRepository | null = null) => ({
  elements,
  baseUrl,
  label: "teste",
  commit: null,
  journey: ir,
  outDir: join(tmpdir(), "aletheia-runner-test"),
  captureFilePath: join(tmpdir(), "aletheia-runner-test", "capture.json"),
  seed: "42",
  screenshots: false,
  headed: false,
  quiescence: { deadlineMs: 15_000, quietWindowMs: 100 },
  secrets: (name: string) => (name === "TEST_SECRET" ? SECRET : undefined),
  logger: createLogger({
    context: { runId: "run_test", orgId: null, projectId: null },
    level: "error",
  }),
  clock: systemClock,
});

describe("interpretador da IR", () => {
  it("navega, preenche, seleciona, clica, observa — e o segredo não aparece em lugar nenhum", async () => {
    const result = await capture(
      options(
        journey([
          { id: "s1", action: "navigate", path: "/" },
          { id: "s2", action: "observe", observationId: "entrar", masks: [] },
          { id: "s3", action: "fill", target: { label: "Nome" }, value: "Ana" },
          {
            id: "s4",
            action: "fill",
            target: { label: "Senha" },
            value: { secretRef: "TEST_SECRET" },
          },
          { id: "s5", action: "select", target: { label: "Perfil" }, value: "editor" },
          { id: "s6", action: "click", target: { role: "button", name: "Entrar" } },
          { id: "s7", action: "observe", observationId: "ola", masks: [] },
        ]),
      ),
    );

    expect(result.capture.interruption).toBeNull();
    expect(result.capture.observations.map((o) => o.observationId)).toEqual(["entrar", "ola"]);
    expect(result.trace.steps.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(result.trace.steps.map((s) => s.resolvedBy)).toEqual([
      null,
      null,
      "label",
      "label",
      "label",
      "role+name",
      null,
    ]);

    const ola = result.capture.observations[1];
    const serialized = JSON.stringify(ola);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain("<secret>");
    // A página ecoou nome e perfil — a ação aconteceu de verdade.
    expect(serialized).toContain("Ana");
    expect(serialized).toContain("perfil=editor");
    // A URL do documento carregou a senha na query e foi mascarada.
    expect(ola?.url).toContain("senha=%3Csecret%3E".replace("%3C", "<").replace("%3E", ">"));
    // A rede da segunda observação é só o que aconteceu depois da primeira.
    expect(ola?.network.every((x) => x.url.includes("/ola.html"))).toBe(true);
  }, 60_000);

  it("alvo que não existe interrompe a jornada: o que veio antes fica, o que viria depois é declarado", async () => {
    const result = await capture(
      options(
        journey([
          { id: "s1", action: "navigate", path: "/" },
          { id: "s2", action: "observe", observationId: "entrar", masks: [] },
          { id: "s3", action: "click", target: { role: "button", name: "Sair" } },
          { id: "s4", action: "observe", observationId: "depois", masks: [] },
        ]),
      ),
    );
    expect(result.capture.observations.map((o) => o.observationId)).toEqual(["entrar"]);
    expect(result.capture.interruption).toEqual({
      stepId: "s3",
      action: "click",
      reason: expect.stringContaining("alvo não encontrado"),
      missingObservationIds: ["depois"],
    });
    expect(result.trace.steps.at(-1)?.status).toBe("failed");
  }, 60_000);

  it("alvo ambíguo é falha do passo com os contadores; nth resolve", async () => {
    const ambiguous = await capture(
      options(
        journey([
          { id: "s1", action: "navigate", path: "/" },
          { id: "s2", action: "click", target: { text: "Ver" } },
          { id: "s3", action: "observe", observationId: "x", masks: [] },
        ]),
      ),
    );
    expect(ambiguous.capture.interruption?.reason).toContain("alvo ambíguo: empate");

    const resolved = await capture(
      options(
        journey([
          { id: "s1", action: "navigate", path: "/" },
          { id: "s2", action: "click", target: { text: "Ver", nth: 1 } },
          { id: "s3", action: "observe", observationId: "x", masks: [] },
        ]),
      ),
    );
    expect(resolved.capture.interruption).toBeNull();
    expect(resolved.trace.steps[1]?.resolvedBy).toBe("text");
    expect(resolved.capture.observations[0]?.url).toContain("nome=b");
  }, 60_000);
});

/**
 * Corpus de mutações conhecidas (CLAUDE.md §7: "medir taxa de resolução e de
 * cura"). O MESMO fingerprint do botão de login contra a página original e
 * contra cada mutação que quebraria um seletor único. O que se espera de cada
 * uma está declarado — inclusive o caso em que o certo é NÃO resolver.
 */
describe("consenso multi-sinal — corpus de mutações do fixture", () => {
  const BUTTON: Target = { testId: "btn-entrar", role: "button", name: "Entrar", text: "Entrar" };

  const clickOn = (page: string, target: Target = BUTTON): IrJourney =>
    journey([
      { id: "s1", action: "navigate", path: `/${page}` },
      { id: "s2", action: "click", target },
      { id: "s3", action: "observe", observationId: "depois", masks: [] },
    ]);

  const CASES: {
    readonly page: string;
    readonly expect: "resolved" | "healed" | "not-found";
    readonly resolvedBy?: string;
  }[] = [
    { page: "index.html", expect: "resolved", resolvedBy: "testId+role+name+text" },
    { page: "mut-reestruturado.html", expect: "resolved", resolvedBy: "testId+role+name+text" },
    { page: "mut-testid-renomeado.html", expect: "healed", resolvedBy: "role+name+text" },
    { page: "mut-texto-mudou.html", expect: "healed", resolvedBy: "testId" },
    { page: "mut-testid-gerado.html", expect: "healed", resolvedBy: "role+name+text" },
    { page: "mut-tudo-mudou.html", expect: "not-found" },
    { page: "mut-botao-sumiu.html", expect: "not-found" },
  ];

  for (const kase of CASES) {
    it(`${kase.page} → ${kase.expect}`, async () => {
      const result = await capture(options(clickOn(kase.page)));
      const step = result.trace.steps[1];
      if (kase.expect === "not-found") {
        expect(result.capture.interruption?.stepId).toBe("s2");
        expect(step?.status).toBe("failed");
        return;
      }
      expect(result.capture.interruption).toBeNull();
      expect(step?.status).toBe("ok");
      expect(step?.resolvedBy).toBe(kase.resolvedBy);
      expect(step?.healed).toBe(kase.expect === "healed");
      // O clique aconteceu de fato: chegou em /ola.html.
      expect(result.capture.observations[0]?.url).toContain("/ola.html");
      if (kase.expect === "healed") {
        const heal = result.trace.healings[0];
        expect(heal?.status).toBe("PROPOSED");
        expect(heal?.stepId).toBe("s2");
        expect(heal?.screenshotPath).toContain("healing/s2.png");
        // A proposta troca só o que falhou pelo que existe.
        if (kase.page === "mut-testid-renomeado.html") {
          expect(heal?.staleSignals).toEqual(["testId"]);
          expect(heal?.proposal.testId).toBe("btn-acessar");
          expect(heal?.proposal.name).toBe("Entrar");
        }
        if (kase.page === "mut-texto-mudou.html") {
          expect(heal?.staleSignals).toEqual(["role+name", "text"]);
          expect(heal?.proposal).toEqual({
            testId: "btn-entrar",
            role: "button",
            name: "Acessar",
            text: "Acessar",
          });
        }
      } else {
        expect(result.trace.healings).toEqual([]);
      }
    }, 60_000);
  }

  it("id gerado é rebaixado e não salva um fingerprint fraco: texto ambíguo continua ambíguo", async () => {
    // `text: "Entrar"` casa o botão E o <h1>. Um testId com cara de gerado vale
    // 0.1 e não desempata — o autor precisa de um sinal de verdade.
    const generated: Target = { testId: "mui-4821", text: "Entrar" };
    const result = await capture(options(clickOn("index.html", generated)));
    expect(result.capture.interruption?.stepId).toBe("s2");
    expect(result.capture.interruption?.reason).toContain("alvo ambíguo");
  }, 60_000);

  it("alvo por ref resolve pelo repositório e o trace registra o elemento", async () => {
    const repository: ElementRepository = {
      version: "0.1.0",
      projectId: "fixture",
      elements: [
        {
          id: "el_btn_entrar",
          description: "botão de login",
          fingerprint: BUTTON,
          stability: { resolvedRuns: 0, healedRuns: 0, lastHealAtUtc: null },
        },
      ],
    };
    const result = await capture(
      options(
        journey([
          { id: "s1", action: "navigate", path: "/mut-testid-renomeado.html" },
          { id: "s2", action: "click", target: { ref: "el_btn_entrar" } },
          { id: "s3", action: "observe", observationId: "depois", masks: [] },
        ]),
        repository,
      ),
    );
    expect(result.trace.steps[1]?.elementRef).toBe("el_btn_entrar");
    expect(result.trace.healings[0]?.elementRef).toBe("el_btn_entrar");
  }, 60_000);

  it("ref sem repositório é erro de IR (plataforma), não interrupção", async () => {
    await expect(
      capture(
        options(
          journey([
            { id: "s1", action: "navigate", path: "/index.html" },
            { id: "s2", action: "click", target: { ref: "el_x" } },
            { id: "s3", action: "observe", observationId: "d", masks: [] },
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code: "IR_INVALID" });
  }, 60_000);
});
