import { describe, expect, it } from "vitest";

import type { Classification, Delta } from "../types/delta.js";

import { measure, type LabelSet } from "./index.js";

const delta = (deltaId: string, classification: Classification): Delta => ({
  deltaId,
  layer: "DOM",
  kind: "DOM_TEXT_CHANGED",
  observationId: "home",
  path: "body > p",
  before: "a",
  after: "b",
  severity: classification === "REGRESSION" ? "HIGH" : "LOW",
  score: classification === "REGRESSION" ? 70 : 10,
  classification,
  suppressedBy: null,
  facts: {},
});

const labels = (entries: Record<string, "REGRESSION" | "INTENDED_CHANGE" | "NOISE">): LabelSet =>
  Object.fromEntries(
    Object.entries(entries).map(([id, label]) => [
      id,
      // Todo rótulo de regressão precisa declarar o defeito de origem; nos
      // testes que não estão medindo defeito, cada delta é um defeito próprio.
      label === "REGRESSION" ? { label, defect: `defeito-${id}` } : { label },
    ]),
  );

/** Rotulagem com atribuição explícita: vários deltas para o mesmo defeito. */
const labelsWithDefects = (entries: Record<string, string>): LabelSet =>
  Object.fromEntries(
    Object.entries(entries).map(([id, defect]) => [id, { label: "REGRESSION" as const, defect }]),
  );

describe("medição de precisão e recall", () => {
  it("separa acerto, falso positivo e falso negativo", () => {
    const deltas = [
      delta("d1", "REGRESSION"), // motor aponta, humano confirma  → TP
      delta("d2", "REGRESSION"), // motor aponta, humano diz ruído → FP
      delta("d3", "UNDETERMINED"), // motor não aponta, era real   → FN
      delta("d4", "UNDETERMINED"), // motor não aponta, era ruído   → TN
    ];
    const result = measure(
      deltas,
      labels({ d1: "REGRESSION", d2: "NOISE", d3: "REGRESSION", d4: "NOISE" }),
    );

    expect(result.blocking.truePositives).toBe(1);
    expect(result.blocking.falsePositives).toBe(1);
    expect(result.blocking.falseNegatives).toBe(1);
    expect(result.blocking.trueNegatives).toBe(1);
    expect(result.blocking.precision).toBe(0.5);
    expect(result.blocking.recall).toBe(0.5);
  });

  it("mudança intencional apontada como regressão conta como falso positivo", () => {
    // Sem fonte de intenção o motor não distingue; o humano distingue. É a
    // diferença entre os dois que precisa ser medida, não escondida.
    const result = measure([delta("d1", "REGRESSION")], labels({ d1: "INTENDED_CHANGE" }));
    expect(result.blocking.falsePositives).toBe(1);
    expect(result.blocking.precision).toBe(0);
  });

  it("o recorte amplo mede o que chega à triagem, não o que bloqueia", () => {
    const result = measure([delta("d1", "UNDETERMINED")], labels({ d1: "REGRESSION" }));

    expect(result.blocking.truePositives).toBe(0);
    expect(result.blocking.falseNegatives).toBe(1);
    // O delta apareceu no relatório — foi detectado, só não bloqueou.
    expect(result.surfaced.truePositives).toBe(1);
  });

  it("delta sem rótulo não entra na conta", () => {
    const result = measure(
      [delta("d1", "REGRESSION"), delta("d2", "REGRESSION")],
      labels({ d1: "REGRESSION" }),
    );

    expect(result.labeled).toBe(1);
    expect(result.unlabeled).toBe(1);
    expect(result.unlabeledDeltaIds).toEqual(["d2"]);
    expect(result.blocking.truePositives).toBe(1);
  });

  it("amostra incompleta nunca atesta o critério de saída", () => {
    const deltas = Array.from({ length: 6 }, (_, index) => delta(`d${index}`, "REGRESSION"));
    const partial = labels(
      Object.fromEntries(deltas.slice(0, 5).map((d) => [d.deltaId, "REGRESSION" as const])),
    );

    const result = measure(deltas, partial);

    expect(result.blocking.truePositives).toBe(5);
    expect(result.exitCriteria.met).toBe(false);
    expect(result.exitCriteria.reason).toContain("sem rótulo humano");
  });

  it("nove deltas do mesmo defeito não valem nove regressões", () => {
    // O caso real que motivou a contagem por defeito: um link de menu quebrado
    // aparece no cabeçalho e no rodapé de sete páginas. Contando deltas, o
    // critério de saída da fase seria atestado por UM defeito.
    const deltas = Array.from({ length: 9 }, (_, index) => delta(`d${index}`, "REGRESSION"));
    const result = measure(
      deltas,
      labelsWithDefects(Object.fromEntries(deltas.map((d) => [d.deltaId, "link-do-menu"]))),
    );

    expect(result.blocking.truePositives).toBe(9);
    expect(result.blockingDefects.detected).toBe(1);
    expect(result.exitCriteria.met).toBe(false);
    expect(result.exitCriteria.reason).toContain("1 defeito(s) distinto(s)");
  });

  it("regressão sem defeito declarado impede a contagem", () => {
    const deltas = Array.from({ length: 6 }, (_, index) => delta(`d${index}`, "REGRESSION"));
    const labelSet: LabelSet = Object.fromEntries(
      deltas.map((d) => [d.deltaId, { label: "REGRESSION" as const }]),
    );

    const result = measure(deltas, labelSet);

    expect(result.blockingDefects.unattributed).toBe(6);
    expect(result.exitCriteria.met).toBe(false);
    expect(result.exitCriteria.reason).toContain("sem defeito declarado");
  });

  it("defeito visto só como UNDETERMINED conta na triagem e não no bloqueio", () => {
    const result = measure(
      [delta("bloqueado", "REGRESSION"), delta("exibido", "UNDETERMINED")],
      labelsWithDefects({ bloqueado: "F1", exibido: "F2" }),
    );

    expect(result.blockingDefects.detected).toBe(1);
    expect(result.blockingDefects.missedIds).toEqual(["F2"]);
    expect(result.surfacedDefects.detected).toBe(2);
  });

  it("atesta o critério da Fase 0 quando há 5 regressões reais e FP abaixo de 10%", () => {
    const deltas = [
      ...Array.from({ length: 9 }, (_, index) => delta(`tp${index}`, "REGRESSION")),
      delta("noise", "UNDETERMINED"),
    ];
    const labelSet = labels({
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`tp${index}`, "REGRESSION" as const]),
      ),
      noise: "NOISE",
    });

    const result = measure(deltas, labelSet);

    expect(result.blocking.truePositives).toBe(9);
    expect(result.blocking.falsePositiveRate).toBe(0);
    expect(result.exitCriteria.met).toBe(true);
  });

  it("reprova o critério quando a taxa de falso positivo bate exatamente 10%", () => {
    const deltas = [
      ...Array.from({ length: 9 }, (_, index) => delta(`tp${index}`, "REGRESSION")),
      delta("fp", "REGRESSION"),
    ];
    const labelSet = labels({
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`tp${index}`, "REGRESSION" as const]),
      ),
      fp: "NOISE",
    });

    const result = measure(deltas, labelSet);

    expect(result.blocking.falsePositiveRate).toBeCloseTo(0.1);
    // "< 10%" é estritamente menor. 10% cravado não passa.
    expect(result.exitCriteria.met).toBe(false);
  });
});
