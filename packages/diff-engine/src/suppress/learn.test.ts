import { readFileSync } from "node:fs";

import type { RunMetadata } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { parseCapture } from "../capture/validate.js";
import type { LabelSet } from "../measure/index.js";
import { runDiff } from "../pipeline.js";
import type { Capture } from "../types/capture.js";
import type { Delta } from "../types/delta.js";
import type { DiffReport } from "../types/report.js";

import { proposeSuppressions, simulateSuppression } from "./learn.js";
import {
  emptySuppressionSet,
  type LearnedSuppressionRule,
  SUPPRESSION_SET_VERSION,
  type SuppressionSet,
} from "./learned.js";

function loadFixture(name: string): Capture {
  const url = new URL(`../../__fixtures__/checkout/${name}.json`, import.meta.url);
  return parseCapture(JSON.parse(readFileSync(url, "utf8")), name);
}

const METADATA: RunMetadata = {
  runId: "run_pr_1",
  worldModelVersion: null,
  irVersion: null,
  runnerVersion: "0.0.0-test",
  browserVersion: null,
  seed: "0",
  commit: "bbbb222",
  baseRef: "main",
  environment: "test",
  confidenceMode: "ISOLATED",
  autonomyLevel: 1,
  startedAtUtc: "2026-01-10T12:10:00.000Z",
};

const NOW = "2026-02-01T00:00:00.000Z";
const real = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
  metadata: METADATA,
});

/** Delta sintético sobre um relatório real, para controlar caminho e rótulo. */
function delta(overrides: Partial<Delta> & Pick<Delta, "deltaId" | "path">): Delta {
  return {
    layer: "DOM",
    kind: "DOM_NODE_REMOVED",
    observationId: "home",
    before: null,
    after: null,
    severity: "HIGH",
    score: 80,
    classification: "REGRESSION",
    suppressedBy: null,
    groupId: "g",
    facts: {},
    ...overrides,
  };
}

function reportWith(deltas: readonly Delta[], runId = "run_pr_1"): DiffReport {
  return { ...real, metadata: { ...real.metadata, runId }, deltas };
}

const MENU = (item: string): string =>
  `body > header > nav > ul > li[role=listitem "Books ${item}"] > div["Browse"] > a[role=link "${item}"]`;

const propose = (report: DiffReport, labels: LabelSet, existing?: SuppressionSet) =>
  proposeSuppressions({
    report,
    labels,
    existing: existing ?? emptySuppressionSet("loja"),
    labeledBy: "qa@loja.example",
    nowUtc: NOW,
  });

describe("proposeSuppressions", () => {
  it("agrupa NOISE de páginas e nomes diferentes numa regra PROPOSED por esqueleto", () => {
    const report = reportWith([
      delta({ deltaId: "d1", observationId: "home", path: MENU("Fiction") }),
      delta({ deltaId: "d2", observationId: "home", path: MENU("Non-Fiction") }),
      delta({ deltaId: "d3", observationId: "cesta", path: MENU("Fiction") }),
      delta({
        deltaId: "d4",
        kind: "DOM_ATTRIBUTE_CHANGED",
        path: 'body > main > a[role=link "CTA"]@href',
      }),
    ]);
    const labels: LabelSet = {
      d1: { label: "NOISE", note: "menu reflete o catálogo" },
      d2: { label: "NOISE" },
      d3: { label: "NOISE" },
      d4: { label: "INTENDED_CHANGE" },
    };

    const outcome = propose(report, labels);

    expect(outcome.created).toEqual(["SUP-loja-001"]);
    expect(outcome.set.rules).toHaveLength(1);
    const rule = outcome.set.rules[0] as LearnedSuppressionRule;
    expect(rule.status).toBe("PROPOSED");
    expect(rule.reviewedBy).toBeNull();
    expect(rule.signature).toEqual({
      layer: "DOM",
      kind: "DOM_NODE_REMOVED",
      pathSkeleton: "body > header > nav > ul > li[role=listitem] > div[*] > a[role=link]",
    });
    // Três deltas, UMA execução: a evidência registra os três, mas são um caso.
    expect(rule.evidence.map((entry) => entry.deltaId)).toEqual(["d1", "d2", "d3"]);
    expect(new Set(rule.evidence.map((entry) => entry.runId))).toEqual(new Set(["run_pr_1"]));
    expect(rule.evidence[0]?.note).toBe("menu reflete o catálogo");
    expect(rule.evidence[0]?.labeledBy).toBe("qa@loja.example");
    // INTENDED_CHANGE não é ruído: mudança pretendida uma vez não é padrão.
    expect(rule.description).toContain("3 delta(s) de 2 observação(ões), 3 bloqueante(s)");
    expect(outcome.conflicts).toEqual([]);
  });

  it("recusa a assinatura que também casa com regressão real — e diz quais", () => {
    const report = reportWith([
      delta({ deltaId: "n1", observationId: "home", path: MENU("Fiction") }),
      delta({ deltaId: "r1", observationId: "cesta", path: MENU("Offers") }),
    ]);
    const outcome = propose(report, {
      n1: { label: "NOISE" },
      r1: { label: "REGRESSION", defect: "D1" },
    });

    expect(outcome.created).toEqual([]);
    expect(outcome.set.rules).toEqual([]);
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]?.noiseDeltaIds).toEqual(["n1"]);
    expect(outcome.conflicts[0]?.regressionDeltaIds).toEqual(["r1"]);
  });

  it("reforça regra existente com evidência de OUTRA execução, sem duplicar a antiga", () => {
    const first = propose(reportWith([delta({ deltaId: "d1", path: MENU("Fiction") })]), {
      d1: { label: "NOISE" },
    });
    // Mesmo relatório de novo: nada muda.
    const again = propose(
      reportWith([delta({ deltaId: "d1", path: MENU("Fiction") })]),
      { d1: { label: "NOISE" } },
      first.set,
    );
    expect(again.created).toEqual([]);
    expect(again.reinforced).toEqual([]);
    expect(again.set.rules[0]?.evidence).toHaveLength(1);

    // O mesmo par re-diffado ganha OUTRO runId, mas os deltaIds são os mesmos:
    // não é evidência nova. Sem isto, três `diff` do mesmo PR "provariam" três
    // execuções distintas.
    const rerun = propose(
      reportWith([delta({ deltaId: "d1", path: MENU("Fiction") })], "run_pr_1_rerun"),
      { d1: { label: "NOISE" } },
      first.set,
    );
    expect(rerun.reinforced).toEqual([]);
    expect(rerun.set.rules[0]?.evidence.map((entry) => entry.runId)).toEqual(["run_pr_1"]);

    const second = propose(
      reportWith([delta({ deltaId: "d9", path: MENU("Clothing") })], "run_pr_2"),
      { d9: { label: "NOISE" } },
      first.set,
    );
    expect(second.created).toEqual([]);
    expect(second.reinforced).toEqual(["SUP-loja-001"]);
    expect(second.set.rules[0]?.evidence.map((entry) => entry.runId)).toEqual([
      "run_pr_1",
      "run_pr_2",
    ]);
  });

  it("não ressuscita REJECTED nem RETIRED — registra a contradição e segue", () => {
    const rejected: SuppressionSet = {
      version: SUPPRESSION_SET_VERSION,
      projectId: "loja",
      rules: [
        {
          id: "SUP-loja-001",
          projectId: "loja",
          status: "REJECTED",
          description: "Rejeitada pelo time: menu é editado à mão e link sumindo é bug",
          signature: {
            layer: "DOM",
            kind: "DOM_NODE_REMOVED",
            pathSkeleton: "body > header > nav > ul > li[role=listitem] > div[*] > a[role=link]",
          },
          evidence: [],
          proposedAtUtc: NOW,
          reviewedBy: "lead@loja.example",
          reviewedAtUtc: NOW,
        },
      ],
    };
    const outcome = propose(
      reportWith([delta({ deltaId: "d1", path: MENU("Fiction") })]),
      { d1: { label: "NOISE" } },
      rejected,
    );
    expect(outcome.contradicted).toEqual(["SUP-loja-001"]);
    expect(outcome.created).toEqual([]);
    expect(outcome.set).toEqual(rejected);
  });

  it("ignora NOISE fora do DOM e conta como fora de escopo", () => {
    const outcome = propose(
      reportWith([
        delta({ deltaId: "n1", layer: "NETWORK", kind: "REQUEST_ADDED", path: "GET /x" }),
        delta({
          deltaId: "v1",
          layer: "VISUAL",
          kind: "VISUAL_REGION_CHANGED",
          path: "screenshot @ 0,0 1×1",
        }),
      ]),
      { n1: { label: "NOISE" }, v1: { label: "NOISE" } },
    );
    expect(outcome.created).toEqual([]);
    expect(outcome.outOfScope).toBe(2);
  });

  it("numera a partir do maior id existente", () => {
    const existing = propose(reportWith([delta({ deltaId: "d1", path: "body > a" })]), {
      d1: { label: "NOISE" },
    }).set;
    const outcome = propose(
      reportWith([delta({ deltaId: "d2", path: "body > b" })]),
      { d2: { label: "NOISE" } },
      existing,
    );
    expect(outcome.created).toEqual(["SUP-loja-002"]);
  });

  it("é determinístico: mesma entrada, mesma saída", () => {
    const report = reportWith([
      delta({ deltaId: "d1", path: MENU("Fiction") }),
      delta({ deltaId: "d2", path: "body > main > p" }),
    ]);
    const labels: LabelSet = { d1: { label: "NOISE" }, d2: { label: "NOISE" } };
    expect(propose(report, labels)).toEqual(propose(report, labels));
  });
});

describe("simulateSuppression", () => {
  const set: SuppressionSet = propose(
    reportWith([delta({ deltaId: "d1", path: MENU("Fiction") })]),
    { d1: { label: "NOISE" } },
  ).set;

  it("diz o que cada regra casaria e a que custo, sem alterar o relatório", () => {
    const report = reportWith([
      delta({ deltaId: "a", path: MENU("Fiction") }),
      delta({ deltaId: "b", path: MENU("Offers"), classification: "UNDETERMINED" }),
      delta({ deltaId: "c", path: "body > main > ol > li" }),
    ]);
    const simulation = simulateSuppression(set, report, {
      a: { label: "NOISE" },
      b: { label: "REGRESSION", defect: "D1" },
    });

    expect(simulation.rules).toHaveLength(1);
    expect(simulation.rules[0]?.matched).toEqual(["a", "b"]);
    expect(simulation.rules[0]?.matchedByClassification).toEqual({
      REGRESSION: 1,
      UNDETERMINED: 1,
      INTENDED_CHANGE: 0,
      NOISE: 0,
    });
    expect(simulation.rules[0]?.matchedByLabel).toEqual({
      regression: 1,
      intendedChange: 0,
      noise: 1,
      unlabeled: 0,
    });
    expect(simulation.wouldSuppress).toEqual(["a", "b"]);
    // `c` continua REGRESSION; `b` é REGRESSION para o humano mas o motor não
    // bloqueou, então não conta como detecção perdida.
    expect(simulation.regressionsRemaining).toBe(1);
    expect(simulation.trueRegressionsLost).toEqual([]);
    expect(report.deltas.map((entry) => entry.classification)).toEqual([
      "REGRESSION",
      "UNDETERMINED",
      "REGRESSION",
    ]);
  });

  it("detecção perdida é delta bloqueado pelo motor E rotulado regressão", () => {
    const report = reportWith([delta({ deltaId: "x", path: MENU("Fiction") })]);
    const simulation = simulateSuppression(set, report, {
      x: { label: "REGRESSION", defect: "D" },
    });
    expect(simulation.trueRegressionsLost).toEqual(["x"]);
    expect(simulation.regressionsRemaining).toBe(0);
  });

  it("sem rótulos, tudo casado é custo desconhecido", () => {
    const report = reportWith([delta({ deltaId: "x", path: MENU("Fiction") })]);
    const simulation = simulateSuppression(set, report, null);
    expect(simulation.rules[0]?.matchedByLabel.unlabeled).toBe(1);
  });
});
