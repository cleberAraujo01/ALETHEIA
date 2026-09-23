import { describe, expect, it } from "vitest";

import type { NormalizedExchange } from "../normalize/network.js";

import { diffNetwork } from "./network.js";
import { DeltaBudget } from "./types.js";

const exchange = (overrides: Partial<NormalizedExchange> = {}): NormalizedExchange => ({
  method: "POST",
  url: "https://events.example/submit",
  status: 200,
  resourceType: "fetch",
  requestBody: null,
  responseBody: { ok: true },
  identityKey: "POST https://events.example/submit",
  durationMs: 10,
  ...overrides,
});

const run = (base: NormalizedExchange, head: NormalizedExchange) =>
  diffNetwork("obs", [base], [head], new DeltaBudget(100));

describe("corpo não observado — medido no piso do Sauce Demo", () => {
  it("<undrained> de um lado contra corpo real do outro NÃO é mudança de tipo", () => {
    // A página abandonou o download numa captura e drenou na outra: a mesma
    // build reprovava a si mesma. Não observado é lacuna, não delta.
    expect(run(exchange({ responseBody: "<undrained>" }), exchange())).toEqual([]);
    expect(run(exchange(), exchange({ responseBody: "<undrained>" }))).toEqual([]);
    expect(run(exchange({ responseBody: "<oversized:900000>" }), exchange())).toEqual([]);
  });

  it("corpo observado dos dois lados com tipo diferente continua sendo RESPONSE_TYPE_CHANGED", () => {
    const deltas = run(exchange(), exchange({ responseBody: "texto" }));
    expect(deltas.map((delta) => delta.kind)).toEqual(["RESPONSE_TYPE_CHANGED"]);
    expect(deltas[0]?.facts["thirdParty"]).toBe(true);
  });

  it("status que muda continua sendo delta mesmo com corpo não observado", () => {
    const deltas = run(
      exchange({ responseBody: "<undrained>", status: 200 }),
      exchange({ status: 500 }),
    );
    expect(deltas.map((delta) => delta.kind)).toEqual(["STATUS_CHANGED"]);
  });
});

describe("prefetch especulativo abortado — medido na rodada 2 do piloto juventude", () => {
  const prefetch = (overrides: Partial<NormalizedExchange> = {}) =>
    exchange({
      method: "GET",
      url: "/canais?_rsc=<token>",
      identityKey: "GET /canais?_rsc=<token>",
      responseBody: '0:{"p":"canais"}',
      ...overrides,
    });

  it("corpo null de um lado contra payload do outro NÃO é mudança de tipo", () => {
    // A navegação abortou o prefetch atrasado: a captura fica com `null`, e
    // `null` × payload virava RESPONSE_TYPE_CHANGED HIGH — bloqueio por timing.
    expect(run(prefetch({ responseBody: null }), prefetch())).toEqual([]);
    expect(run(prefetch(), prefetch({ responseBody: null }))).toEqual([]);
  });

  it("em endpoint de dado de verdade, null de um lado continua sendo comparado", () => {
    const deltas = run(
      exchange({
        method: "GET",
        url: "/api/canais",
        identityKey: "GET /api/canais",
        responseBody: null,
      }),
      exchange({ method: "GET", url: "/api/canais", identityKey: "GET /api/canais" }),
    );
    expect(deltas.map((delta) => delta.kind)).toEqual(["RESPONSE_TYPE_CHANGED"]);
  });

  it("prefetch que sumiu carrega a marca especulativa para a severidade decidir", () => {
    const deltas = diffNetwork("obs", [prefetch()], [], new DeltaBudget(100));
    expect(deltas.map((delta) => delta.kind)).toEqual(["REQUEST_REMOVED"]);
    expect(deltas[0]?.facts["speculative"]).toBe(true);
  });
});

describe("lista de objetos com id alinha por id — medido no D2 do aletheia-demo", () => {
  const catalogo = (ids: readonly string[], extra: Record<string, number> = {}) =>
    exchange({
      method: "GET",
      url: "https://loja.exemplo/data/produtos.json",
      resourceType: "fetch",
      identityKey: "GET https://loja.exemplo/data/produtos.json",
      responseBody: {
        produtos: ids.map((id) => ({ id, preco: extra[id] ?? 100 })),
      },
    });

  it("item que some no meio é UM delta, que diz qual — não dois 'mudou' e um 'sumiu' no fim", () => {
    const deltas = run(catalogo(["a", "b", "c", "d"]), catalogo(["a", "b", "d"]));
    expect(deltas.map((d) => `${d.kind} ${d.path}`)).toEqual([
      "RESPONSE_FIELD_REMOVED GET https://loja.exemplo/data/produtos.json#0 response/produtos/[id=c]",
    ]);
    expect(deltas[0]?.facts).toMatchObject({
      alignedBy: "id",
      id: "c",
      baseLength: 4,
      headLength: 3,
    });
  });

  it("campo que muda dentro de um item aponta o item pelo id", () => {
    const deltas = run(catalogo(["a", "b"]), catalogo(["a", "b"], { b: 90 }));
    expect(deltas.map((d) => `${d.kind} ${d.path}`)).toEqual([
      "RESPONSE_FIELD_CHANGED GET https://loja.exemplo/data/produtos.json#0 response/produtos/[id=b]/preco",
    ]);
  });

  it("lista REORDENADA cai na comparação por posição: ordenação que muda continua visível", () => {
    const deltas = run(catalogo(["a", "b"]), catalogo(["b", "a"]));
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((d) => /\/produtos\/\d/.test(d.path))).toBe(true);
  });

  it("sem id em algum elemento, ou id repetido, é posição como sempre", () => {
    const semId = exchange({
      responseBody: { itens: [{ id: "a" }, { nome: "sem id" }] },
      identityKey: "k",
    });
    const semIdHead = exchange({ responseBody: { itens: [{ id: "a" }] }, identityKey: "k" });
    expect(run(semId, semIdHead).map((d) => d.path)).toEqual([
      "POST https://events.example/submit#0 response/itens/1",
    ]);
    const repetido = exchange({
      responseBody: { itens: [{ id: "a" }, { id: "a" }] },
      identityKey: "k",
    });
    const repetidoHead = exchange({ responseBody: { itens: [{ id: "a" }] }, identityKey: "k" });
    expect(run(repetido, repetidoHead).map((d) => d.path)).toEqual([
      "POST https://events.example/submit#0 response/itens/1",
    ]);
  });
});
