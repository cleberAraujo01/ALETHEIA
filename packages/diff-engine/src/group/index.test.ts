import { readFileSync } from "node:fs";

import type { RunMetadata } from "@aletheia/shared";
import { describe, expect, it } from "vitest";

import { parseCapture } from "../capture/validate.js";
import { assessGrouping } from "../measure/index.js";
import { runDiff } from "../pipeline.js";
import { signatureOf } from "../signature/index.js";
import type { Capture } from "../types/capture.js";
import type { Delta } from "../types/delta.js";

import { groupDeltas, groupIdOf } from "./index.js";

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

function delta(overrides: Partial<Delta> & Pick<Delta, "deltaId" | "path">): Delta {
  return {
    layer: "DOM",
    kind: "DOM_ATTRIBUTE_REMOVED",
    observationId: "home",
    before: null,
    after: null,
    severity: "HIGH",
    score: 80,
    classification: "REGRESSION",
    suppressedBy: null,
    groupId: "",
    facts: {},
    ...overrides,
  };
}

const THUMB = (page: string, product: string): Delta =>
  delta({
    deltaId: `${page}-${product}`,
    observationId: page,
    path: `body > ol > li[role=listitem "${product}"] > article > a > img[role=img "${product}"]@alt`,
  });

describe("groupDeltas", () => {
  it("junta o mesmo defeito visto em muitas páginas e produtos num grupo só", () => {
    const deltas = [
      THUMB("catalogue", "Snow Crash"),
      THUMB("catalogue", "Little Brother"),
      THUMB("ofertas", "Galatea 2.2"),
      delta({
        deltaId: "x",
        kind: "DOM_NODE_REMOVED",
        path: "body > ol > li[role=listitem]",
        score: 70,
      }),
    ];
    const groups = groupDeltas(deltas);

    expect(groups).toHaveLength(2);
    const thumbs = groups[0];
    expect(thumbs?.deltaIds).toEqual([
      "catalogue-Snow Crash",
      "catalogue-Little Brother",
      "ofertas-Galatea 2.2",
    ]);
    expect(thumbs?.observationIds).toEqual(["catalogue", "ofertas"]);
    expect(thumbs?.pathSkeleton).toBe(
      "body > ol > li[role=listitem] > article > a > img[role=img]@alt",
    );
    expect(thumbs?.severity).toBe("HIGH");
    expect(thumbs?.classification).toBe("REGRESSION");
    expect(thumbs?.byClassification.REGRESSION).toBe(3);
  });

  it("visual não agrupa entre páginas — mesma coordenada não é o mesmo elemento", () => {
    const groups = groupDeltas([
      delta({
        deltaId: "v1",
        layer: "VISUAL",
        kind: "VISUAL_REGION_CHANGED",
        observationId: "home",
        path: "screenshot @ 0,0 144×32",
      }),
      delta({
        deltaId: "v2",
        layer: "VISUAL",
        kind: "VISUAL_REGION_CHANGED",
        observationId: "contato",
        path: "screenshot @ 0,0 144×32",
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("não junta tipos diferentes no mesmo lugar — remoção não é mudança de atributo", () => {
    const groups = groupDeltas([
      delta({ deltaId: "a", kind: "DOM_NODE_REMOVED", path: 'body > nav > a[role=link "X"]' }),
      delta({
        deltaId: "b",
        kind: "DOM_ATTRIBUTE_CHANGED",
        path: 'body > nav > a[role=link "X"]@href',
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("o groupId é o hash da assinatura — mesmo par, mesmos grupos, e a supressão usa a mesma chave", () => {
    const a = THUMB("catalogue", "Snow Crash");
    const b = THUMB("ofertas", "Galatea 2.2");
    expect(groupIdOf(a)).toBe(groupIdOf(b));
    expect(signatureOf(a)).toEqual(signatureOf(b));
    expect(groupDeltas([a, b])[0]?.groupId).toBe(groupIdOf(a));
  });

  it("classificação do grupo é a mais alta presente; severidade e score são os piores", () => {
    const groups = groupDeltas([
      delta({
        deltaId: "a",
        path: "body > p",
        classification: "UNDETERMINED",
        severity: "MEDIUM",
        score: 40,
      }),
      delta({
        deltaId: "b",
        path: "body > p",
        classification: "REGRESSION",
        severity: "HIGH",
        score: 80,
      }),
      delta({
        deltaId: "c",
        path: "body > p",
        classification: "NOISE",
        severity: "LOW",
        score: 10,
      }),
    ]);
    expect(groups[0]?.classification).toBe("REGRESSION");
    expect(groups[0]?.severity).toBe("HIGH");
    expect(groups[0]?.score).toBe(80);
  });

  it("ordem é determinística: mais grave, depois maior, depois chave", () => {
    const deltas = [
      delta({ deltaId: "1", path: "body > z", score: 50 }),
      delta({ deltaId: "2", path: "body > a", score: 50 }),
      delta({ deltaId: "3", path: "body > a", score: 50 }),
      delta({ deltaId: "4", path: "body > m", score: 90 }),
    ];
    const order = groupDeltas(deltas).map((group) => group.pathSkeleton);
    expect(order).toEqual(["body > m", "body > a", "body > z"]);
    expect(groupDeltas([...deltas].reverse()).map((group) => group.pathSkeleton)).toEqual(order);
  });
});

describe("agrupamento no pipeline — corpus checkout", () => {
  const report = runDiff(loadFixture("base"), loadFixture("head-with-regressions"), {
    metadata: METADATA,
  });

  it("todo delta aponta para um grupo do relatório, e os grupos cobrem todos os deltas", () => {
    const ids = new Set(report.groups.map((group) => group.groupId));
    for (const delta of report.deltas) expect(ids.has(delta.groupId)).toBe(true);
    expect(report.groups.flatMap((group) => group.deltaIds).sort()).toEqual(
      report.deltas.map((delta) => delta.deltaId).sort(),
    );
  });

  it("resumo e veredito contam grupos sem mudar o que já contavam", () => {
    expect(report.summary.groups.total).toBe(report.groups.length);
    expect(report.summary.groups.REGRESSION).toBe(
      report.groups.filter((group) => group.classification === "REGRESSION").length,
    );
    expect(report.summary.byClassification.REGRESSION).toBeGreaterThanOrEqual(5);
    expect(report.verdict.rationale).toMatch(/\d+ delta\(s\) em \d+ grupo\(s\)/);
  });
});

describe("assessGrouping — a distância entre grupo e defeito", () => {
  const groups = groupDeltas([
    THUMB("catalogue", "A"),
    THUMB("ofertas", "B"),
    delta({ deltaId: "n1", kind: "DOM_NODE_REMOVED", path: 'body > ol > li[role=listitem "A"]' }),
    delta({ deltaId: "n2", kind: "DOM_NODE_REMOVED", path: 'body > ol > li[role=listitem "B"]' }),
    delta({ deltaId: "solto", path: "body > footer > a@href" }),
  ]);

  it("grupo puro por defeito, um defeito por grupo", () => {
    const a = assessGrouping(groups, {
      "catalogue-A": { label: "REGRESSION", defect: "O7" },
      "ofertas-B": { label: "REGRESSION", defect: "O7" },
      n1: { label: "REGRESSION", defect: "O6" },
      n2: { label: "REGRESSION", defect: "O6" },
    });
    expect(a.groups).toBe(3);
    expect(a.labeledGroups).toBe(2);
    expect(a.mixedDefects).toEqual([]);
    expect(a.mixedWithNonRegression).toEqual([]);
    expect(a.groupsPerDefect).toEqual({ O7: 1, O6: 1 });
    expect(a.regressionGroupsPerDefect).toEqual({ O7: 1, O6: 1 });
  });

  it("denuncia grupo que mistura defeitos e grupo que mistura regressão com ruído", () => {
    const a = assessGrouping(groups, {
      "catalogue-A": { label: "REGRESSION", defect: "O7" },
      "ofertas-B": { label: "REGRESSION", defect: "O9" },
      n1: { label: "REGRESSION", defect: "O6" },
      n2: { label: "NOISE" },
    });
    expect(a.mixedDefects).toHaveLength(1);
    expect(a.mixedWithNonRegression).toHaveLength(1);
    expect(a.mixedDefects[0]).not.toBe(a.mixedWithNonRegression[0]);
  });
});
