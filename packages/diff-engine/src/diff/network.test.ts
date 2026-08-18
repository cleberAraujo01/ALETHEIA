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
