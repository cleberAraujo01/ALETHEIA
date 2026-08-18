import { readFileSync } from "node:fs";

import { PlatformError, type RunMetadata } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { parseCapture } from "../capture/validate.js";
import { runDiff } from "../pipeline.js";
import type { Capture } from "../types/capture.js";

import {
  compileLearnedRules,
  emptySuppressionSet,
  type LearnedSuppressionRule,
  matchesSignature,
  parseSuppressionSet,
  pathSkeleton,
  SUPPRESSION_SET_VERSION,
  type SuppressionSet,
  validateSuppressionSet,
} from "./learned.js";
import { MIN_EVIDENCE } from "./rule.js";

const evidence = (run: number): LearnedSuppressionRule["evidence"][number] => ({
  runId: `run_${run}`,
  deltaId: `delta_${run}`,
  labeledBy: "qa@cliente.example",
  labeledAtUtc: "2026-01-10T12:00:00.000Z",
  note: "rotina nesta aplicação",
});

const rule = (overrides: Partial<LearnedSuppressionRule> = {}): LearnedSuppressionRule => ({
  id: "SUP-loja-001",
  projectId: "loja",
  status: "PROPOSED",
  description: "Itens do menu 'Browse store' refletem o catálogo e entram e saem com ele",
  signature: {
    layer: "DOM",
    kind: "DOM_NODE_REMOVED",
    pathSkeleton: "body > header > nav > ul > li[role=listitem] > div[*] > a[role=link]",
  },
  evidence: [evidence(1), evidence(2), evidence(3)],
  proposedAtUtc: "2026-01-10T12:00:00.000Z",
  reviewedBy: null,
  reviewedAtUtc: null,
  ...overrides,
});

const set = (...rules: LearnedSuppressionRule[]): SuppressionSet => ({
  version: SUPPRESSION_SET_VERSION,
  projectId: "loja",
  rules,
});

describe("pathSkeleton — estrutura sem nome", () => {
  it("apaga nomes acessíveis e preserva tag, id, papel, ordinal e atributo", () => {
    expect(
      pathSkeleton(
        "DOM",
        'body#default > header > nav > ul > li[role=listitem "Browse store Books Fiction"] > div["Browse store"] > a[role=link "Fiction"]',
      ),
    ).toBe("body#default > header > nav > ul > li[role=listitem] > div[*] > a[role=link]");

    expect(
      pathSkeleton("DOM", 'body > div[1] > div[0] > a[role=link "Como funciona →"]@href'),
    ).toBe("body > div[1] > div[0] > a[role=link]@href");
  });

  it("preserva data-testid — é identidade estável, não conteúdo", () => {
    expect(pathSkeleton("DOM", 'main > button[data-testid="apply-coupon"]')).toBe(
      'main > button[data-testid="apply-coupon"]',
    );
  });

  it("nome vazio também sai", () => {
    expect(pathSkeleton("DOM", 'form > input[role=textbox ""]@id')).toBe(
      "form > input[role=textbox]@id",
    );
  });

  it("dois nós com nomes diferentes na mesma estrutura têm o MESMO esqueleto", () => {
    const a = pathSkeleton("DOM", 'ul > li[role=listitem "Fiction"] > a[role=link "Fiction"]');
    const b = pathSkeleton("DOM", 'ul > li[role=listitem "Clothing"] > a[role=link "Clothing"]');
    expect(a).toBe(b);
  });

  it("fora do DOM, o caminho é o próprio esqueleto", () => {
    expect(pathSkeleton("NETWORK", 'GET /api/x?q="a"#0 response/total')).toBe(
      'GET /api/x?q="a"#0 response/total',
    );
  });
});

describe("matchesSignature", () => {
  const signature = rule().signature;

  it("casa por camada, tipo e esqueleto — o nome não importa", () => {
    expect(
      matchesSignature(signature, {
        layer: "DOM",
        kind: "DOM_NODE_REMOVED",
        path: 'body > header > nav > ul > li[role=listitem "Books"] > div["Browse"] > a[role=link "Clothing"]',
      }),
    ).toBe(true);
  });

  it("não casa outro tipo no mesmo lugar — remoção não é mudança de href", () => {
    expect(
      matchesSignature(signature, {
        layer: "DOM",
        kind: "DOM_ATTRIBUTE_CHANGED",
        path: 'body > header > nav > ul > li[role=listitem "Books"] > div["Browse"] > a[role=link "Offers"]@href',
      }),
    ).toBe(false);
  });

  it("não casa outra estrutura — um item de listagem não é um item de menu", () => {
    expect(
      matchesSignature(signature, {
        layer: "DOM",
        kind: "DOM_NODE_REMOVED",
        path: 'body > main > section > ol > li[role=listitem "Produto"]',
      }),
    ).toBe(false);
  });
});

describe("parseSuppressionSet", () => {
  it("lê um conjunto bem formado e devolve o mesmo conteúdo", () => {
    const parsed = parseSuppressionSet(JSON.parse(JSON.stringify(set(rule()))), "teste");
    expect(parsed).toEqual(set(rule()));
  });

  it("recusa versão desconhecida, raiz sem projectId, regra sem assinatura e evidência incompleta", () => {
    const bad = (raw: unknown): void => {
      expect(() => parseSuppressionSet(raw, "teste")).toThrow(PlatformError);
    };
    bad({ ...set(), version: "9.9.9" });
    bad({ ...set(), projectId: "" });
    bad(set({ ...rule(), signature: { layer: "DOM" } as never }));
    bad(set({ ...rule(), evidence: [{ runId: "r" }] as never }));
    bad(set({ ...rule(), status: "APPROVED" as never }));
    bad(set({ ...rule(), id: "regra-1" }));
  });

  it("o erro é de plataforma — arquivo de supressão quebrado não é culpa do código do cliente", () => {
    try {
      parseSuppressionSet({ version: SUPPRESSION_SET_VERSION }, "x.json");
      expect.fail("deveria lançar");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformError);
      expect((error as PlatformError).code).toBe("SUPPRESSION_SET_INVALID");
    }
  });
});

describe("validateSuppressionSet", () => {
  it("aceita PROPOSED sem revisor e sem evidência suficiente — é pergunta, não supressão", () => {
    expect(validateSuppressionSet(set(rule({ evidence: [evidence(1)] })))).toEqual([]);
  });

  it("recusa ACTIVE sem revisor identificado", () => {
    const issues = validateSuppressionSet(set(rule({ status: "ACTIVE" })));
    expect(issues.map((issue) => issue.problem).join(" ")).toContain("sem reviewedBy");
  });

  it(`recusa ACTIVE com evidência de menos de ${MIN_EVIDENCE} execuções distintas`, () => {
    const oneRun = [
      evidence(1),
      { ...evidence(1), deltaId: "d2" },
      { ...evidence(1), deltaId: "d3" },
    ];
    const issues = validateSuppressionSet(
      set(
        rule({
          status: "ACTIVE",
          reviewedBy: "qa",
          reviewedAtUtc: "2026-01-11T00:00:00.000Z",
          evidence: oneRun,
        }),
      ),
    );
    expect(issues.map((issue) => issue.problem).join(" ")).toContain("1 execução(ões) distinta(s)");
  });

  it("aceita ACTIVE com revisor e evidência de execuções distintas", () => {
    expect(
      validateSuppressionSet(
        set(
          rule({ status: "ACTIVE", reviewedBy: "qa", reviewedAtUtc: "2026-01-11T00:00:00.000Z" }),
        ),
      ),
    ).toEqual([]);
  });

  it("recusa id duplicado e projectId divergente", () => {
    const issues = validateSuppressionSet(set(rule(), rule({ projectId: "outra" })));
    expect(issues.map((issue) => issue.problem)).toEqual(
      expect.arrayContaining(["id duplicado", expect.stringContaining("difere do conjunto")]),
    );
  });
});

describe("compileLearnedRules", () => {
  it("só compila ACTIVE — PROPOSED, REJECTED e RETIRED não suprimem nada", () => {
    const active = rule({
      id: "SUP-loja-002",
      status: "ACTIVE",
      reviewedBy: "qa",
      reviewedAtUtc: "2026-01-11T00:00:00.000Z",
    });
    const compiled = compileLearnedRules(
      set(
        rule({ id: "SUP-loja-001", status: "PROPOSED" }),
        active,
        rule({ id: "SUP-loja-003", status: "REJECTED", reviewedBy: "qa", reviewedAtUtc: "x" }),
        rule({ id: "SUP-loja-004", status: "RETIRED", reviewedBy: "qa", reviewedAtUtc: "x" }),
      ),
    );
    expect(compiled.map((entry) => entry.id)).toEqual(["SUP-loja-002"]);
    expect(
      compiled[0]?.matches({
        layer: "DOM",
        kind: "DOM_NODE_REMOVED",
        observationId: "o",
        path: 'body > header > nav > ul > li[role=listitem "X"] > div["Y"] > a[role=link "Z"]',
        before: null,
        after: null,
        facts: {},
      }),
    ).toBe(true);
  });

  it("conjunto vazio compila para lista vazia", () => {
    expect(compileLearnedRules(emptySuppressionSet("loja"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ponta a ponta no corpus sintético: a regra aprendida dentro do pipeline
// ---------------------------------------------------------------------------

function loadFixture(name: string): Capture {
  const url = new URL(`../../__fixtures__/checkout/${name}.json`, import.meta.url);
  return parseCapture(JSON.parse(readFileSync(url, "utf8")), name);
}

const METADATA: RunMetadata = {
  runId: "run_test",
  worldModelVersion: null,
  irVersion: null,
  runnerVersion: "0.0.0-test",
  browserVersion: null,
  seed: "0",
  commit: "bbbb222",
  baseRef: "main",
  environment: "test",
  confidenceMode: "ISOLATED",
  dataStrategy: null,
  autonomyLevel: 1,
  startedAtUtc: "2026-01-10T12:10:00.000Z",
};

describe("regra aprendida no pipeline — corpus checkout", () => {
  const base = loadFixture("base");
  const head = loadFixture("head-with-regressions");
  const couponRule = rule({
    id: "SUP-checkout-001",
    projectId: "checkout",
    signature: {
      layer: "DOM",
      kind: "DOM_NODE_REMOVED",
      pathSkeleton: 'main > button[data-testid="apply-coupon"]',
    },
  });
  const checkoutSet = (r: LearnedSuppressionRule): SuppressionSet => ({
    version: SUPPRESSION_SET_VERSION,
    projectId: "checkout",
    rules: [r],
  });

  it("ACTIVE com evidência suprime o delta casado, e SÓ ele; o resto do veredito não muda", () => {
    const without = runDiff(base, head, { metadata: METADATA });
    const active = {
      ...couponRule,
      status: "ACTIVE" as const,
      reviewedBy: "qa",
      reviewedAtUtc: "x",
    };
    const report = runDiff(base, head, {
      metadata: METADATA,
      suppressionRules: compileLearnedRules(checkoutSet(active)),
    });

    const coupon = report.deltas.find((delta) => delta.path.includes("apply-coupon"));
    expect(coupon?.classification).toBe("NOISE");
    expect(coupon?.suppressedBy).toBe("SUP-checkout-001");
    // A severidade continua HIGH: suprimir é classificar, não esconder.
    expect(coupon?.severity).toBe("HIGH");

    expect(report.summary.byClassification.REGRESSION).toBe(
      without.summary.byClassification.REGRESSION - 1,
    );
    expect(report.summary.byClassification.NOISE).toBe(1);
    expect(report.verdict.code).toBe("REGRESSION_DETECTED");
    expect(report.suppression).toEqual({
      catalogSize: 1,
      activeRuleIds: ["SUP-checkout-001"],
      deltasSuppressed: 1,
      byRule: { "SUP-checkout-001": 1 },
    });
  });

  it("PROPOSED não suprime nada, mesmo com evidência de sobra", () => {
    const report = runDiff(base, head, {
      metadata: METADATA,
      suppressionRules: compileLearnedRules(checkoutSet(couponRule)),
    });
    expect(report.summary.byClassification.NOISE).toBe(0);
    expect(report.suppression.activeRuleIds).toEqual([]);
  });

  it("o motor se recusa a rodar com ACTIVE sem evidência de execuções distintas", () => {
    const oneRun = [
      evidence(1),
      { ...evidence(1), deltaId: "d2" },
      { ...evidence(1), deltaId: "d3" },
    ];
    const active = {
      ...couponRule,
      status: "ACTIVE" as const,
      reviewedBy: "qa",
      reviewedAtUtc: "x",
      evidence: oneRun,
    };
    expect(() =>
      runDiff(base, head, {
        metadata: METADATA,
        suppressionRules: compileLearnedRules(checkoutSet(active)),
      }),
    ).toThrow(PlatformError);
  });
});
