import { describe, expect, it } from "vitest";

import { irToJourney } from "./migrate.js";
import { IR_VERSION } from "./schema.js";
import { parseIr } from "./validate.js";

const journey = (observe: Record<string, unknown>) => ({
  irVersion: IR_VERSION,
  id: "jr_loja",
  name: "loja",
  viewport: { width: 1280, height: 800 },
  steps: [
    { id: "st_01", action: "navigate", path: "/carrinho" },
    {
      id: "st_02",
      action: "observe",
      observationId: "carrinho",
      masks: [],
      database: [],
      ...observe,
    },
  ],
});

const SOMA = {
  id: "total-e-soma",
  kind: "SUM_EQUALS",
  parts: "data-centavos-subtotal",
  total: "data-centavos-total",
};

describe("relação metamórfica na IR (O3) — o D5 do aletheia-demo pediu", () => {
  it("observe sem relations é observe como sempre: lista vazia", () => {
    const ir = parseIr(journey({}), "t");
    const observe = ir.steps[1];
    expect(observe?.action === "observe" ? observe.relations : null).toEqual([]);
  });

  it("aceita SUM_EQUALS com dois atributos data-* distintos", () => {
    const ir = parseIr(journey({ relations: [SOMA] }), "t");
    const observe = ir.steps[1];
    expect(observe?.action === "observe" ? observe.relations : null).toEqual([SOMA]);
  });

  for (const [caso, relation] of [
    ["atributo que não é data-*", { ...SOMA, parts: "subtotal" }],
    ["parts igual a total", { ...SOMA, total: SOMA.parts }],
    ["relação desconhecida", { ...SOMA, kind: "PRODUCT_EQUALS" }],
    ["id inválido", { ...SOMA, id: "Total Soma" }],
  ] as const) {
    it(`recusa ${caso}`, () => {
      expect(() => parseIr(journey({ relations: [relation] }), "t")).toThrowError(
        expect.objectContaining({ code: "IR_INVALID" }) as Error,
      );
    });
  }

  it("recusa id de relação duplicado na mesma observação", () => {
    expect(() => parseIr(journey({ relations: [SOMA, SOMA] }), "t")).toThrowError(
      expect.objectContaining({ code: "IR_INVALID" }) as Error,
    );
  });

  it("não cabe no formato 0.1.0 — a migração para baixo recusa em vez de perder a verificação", () => {
    const ir = parseIr(journey({ relations: [SOMA] }), "t");
    expect(() => irToJourney(ir)).toThrowError(
      expect.objectContaining({ code: "IR_INVALID" }) as Error,
    );
  });
});
