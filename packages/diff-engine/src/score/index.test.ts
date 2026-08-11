import { describe, expect, it } from "vitest";

import type { RawDelta } from "../diff/types.js";
import { severityOf } from "./index.js";

const delta = (overrides: Partial<RawDelta>): RawDelta => ({
  layer: "NETWORK",
  kind: "REQUEST_REMOVED",
  observationId: "home",
  path: "GET /api/orders",
  before: null,
  after: null,
  facts: {},
  ...overrides,
});

/**
 * Estes casos vêm de execução real, não de raciocínio de escrivaninha:
 * comparar duas capturas da MESMA build de uma aplicação em produção
 * (7 rotas, ~350 nós de DOM cada, 33 requisições) produziu exatamente um
 * delta — um script de analytics de terceiro que carregou numa execução e não
 * na outra. Com a calibração inicial ele era HIGH e bloqueava o PR.
 *
 * Travar isso em teste evita que a regra volte por descuido.
 */
describe("severidade de rede — sinal próprio vs. ruído de terceiro", () => {
  it("endpoint próprio que desaparece é sinal forte", () => {
    expect(
      severityOf(delta({ facts: { dataResource: true, thirdParty: false } })),
    ).toBe("HIGH");
  });

  it("script de terceiro que não carregou não bloqueia PR nenhum", () => {
    expect(
      severityOf(
        delta({
          path: "GET https://plausible.io/js/script.js",
          facts: { dataResource: false, thirdParty: true, resourceType: "script" },
        }),
      ),
    ).toBe("LOW");
  });

  it("subrecurso próprio fica no meio: reportável, não bloqueante", () => {
    expect(
      severityOf(delta({ facts: { dataResource: false, thirdParty: false } })),
    ).toBe("MEDIUM");
  });

  it("erro de terceiro é indisponibilidade de ambiente, não regressão do cliente", () => {
    expect(
      severityOf(
        delta({
          kind: "STATUS_CHANGED",
          facts: { baseStatus: 200, headStatus: 503, headIsError: true, thirdParty: true },
        }),
      ),
    ).toBe("MEDIUM");
  });

  it("sucesso virando erro na própria aplicação é o caso mais grave", () => {
    expect(
      severityOf(
        delta({
          kind: "STATUS_CHANGED",
          facts: { baseStatus: 200, headStatus: 500, headIsError: true, thirdParty: false },
        }),
      ),
    ).toBe("CRITICAL");
  });

  it("N+1 emergente na própria aplicação é sinal forte", () => {
    expect(
      severityOf(
        delta({ kind: "REQUEST_COUNT_CHANGED", facts: { amplification: 8, thirdParty: false } }),
      ),
    ).toBe("HIGH");
  });

  it("delta visual nunca ultrapassa MEDIUM enquanto não houver calibração", () => {
    expect(
      severityOf(
        delta({ layer: "VISUAL", kind: "VISUAL_REGION_CHANGED", facts: { areaRatio: 0.9 } }),
      ),
    ).toBe("MEDIUM");
  });
});
