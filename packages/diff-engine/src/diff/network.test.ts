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
