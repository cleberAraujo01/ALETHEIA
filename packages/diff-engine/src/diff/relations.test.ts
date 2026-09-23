import { describe, expect, it } from "vitest";

import type { DomNode, RelationSpec } from "../types/capture.js";

import { diffRelations, evaluate } from "./relations.js";
import { DeltaBudget } from "./types.js";

const node = (
  tag: string,
  attributes: Record<string, string> = {},
  children: DomNode[] = [],
): DomNode => ({ tag, attributes, text: null, role: null, accessibleName: null, children });

/** Carrinho com subtotais em centavos e um total — o D5 do aletheia-demo em miniatura. */
const carrinho = (subtotais: number[], total: number): DomNode =>
  node("table", {}, [
    node(
      "tbody",
      {},
      subtotais.map((s) => node("tr", {}, [node("td", { "data-centavos-subtotal": String(s) })])),
    ),
    node("tfoot", {}, [node("tr", {}, [node("th", { "data-centavos-total": String(total) })])]),
  ]);

const SOMA: RelationSpec = {
  id: "total-e-soma",
  kind: "SUM_EQUALS",
  parts: "data-centavos-subtotal",
  total: "data-centavos-total",
};

const run = (base: DomNode | null, head: DomNode | null) =>
  diffRelations("carrinho", [SOMA], base, head, new DeltaBudget(100));

describe("relação metamórfica SUM_EQUALS — o D5 do aletheia-demo", () => {
  it("total certo nos dois lados: nada", () => {
    expect(run(carrinho([16142, 22084], 38226), carrinho([16142, 22084], 38226))).toEqual([]);
  });

  it("total que ignora a quantidade: VIOLADA no head, válida na base → um delta, com os números", () => {
    const deltas = run(carrinho([16142, 22084], 38226), carrinho([16142, 22084], 27184));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      layer: "DOM",
      kind: "RELATION_VIOLATED",
      observationId: "carrinho",
      path: "relation:total-e-soma",
      facts: { headSum: 38226, headTotal: 27184, headParts: 2, alreadyBroken: false },
    });
    expect(deltas[0]?.after).toContain("VIOLADA");
  });

  it("violada nos DOIS lados é defeito pré-existente: o fato diz, a severidade decide", () => {
    const deltas = run(carrinho([100, 200], 999), carrinho([100, 200], 999));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.facts["alreadyBroken"]).toBe(true);
  });

  it("valores diferentes mas relação válida dos dois lados (reajuste de preço) não é nada", () => {
    expect(run(carrinho([100, 200], 300), carrinho([110, 220], 330))).toEqual([]);
  });

  it("atributo ausente, total duplicado ou valor não inteiro é INAVALIÁVEL, nunca violação", () => {
    const semTotal = node("table", {}, [node("td", { "data-centavos-subtotal": "1" })]);
    expect(run(carrinho([1], 1), semTotal).map((d) => d.kind)).toEqual(["RELATION_UNEVALUABLE"]);
    const doisTotais = node("div", {}, [
      node("td", { "data-centavos-subtotal": "1" }),
      node("th", { "data-centavos-total": "1" }),
      node("th", { "data-centavos-total": "1" }),
    ]);
    expect(evaluate(SOMA, doisTotais)).toEqual({
      reason: "2 elementos com data-centavos-total; esperado exatamente um",
    });
    const texto = node("div", {}, [
      node("td", { "data-centavos-subtotal": "R$ 1,00" }),
      node("th", { "data-centavos-total": "100" }),
    ]);
    expect(evaluate(SOMA, texto)).toEqual({
      reason: 'data-centavos-subtotal="R$ 1,00" não é inteiro',
    });
  });

  it("base sem DOM não impede avaliar o head — a relação é da tela, não do par", () => {
    const deltas = run(null, carrinho([1, 2], 4));
    expect(deltas.map((d) => `${d.kind}:${String(d.facts["alreadyBroken"])}`)).toEqual([
      "RELATION_VIOLATED:false",
    ]);
  });
});
