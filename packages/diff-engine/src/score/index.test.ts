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

/**
 * Estes casos vêm da medição de saída da Fase 0 contra o corpus `juventude`
 * (par de builds com 9 defeitos + par de commits reais só com mudança
 * intencional). Cada um trava uma distinção que a medição custou a produzir.
 */
describe("severidade de DOM — destino vs. entrega, conteúdo vs. estrutura", () => {
  const dom = (kind: RawDelta["kind"], facts: RawDelta["facts"]): RawDelta =>
    delta({ layer: "DOM", kind, path: "body > a", facts });

  it("href que muda é destino de ação do usuário: bloqueia", () => {
    expect(severityOf(dom("DOM_ATTRIBUTE_CHANGED", { attribute: "href" }))).toBe("HIGH");
  });

  it("src que muda é entrega do mesmo recurso: reporta, não bloqueia", () => {
    // Um PR real da aplicação recomprimiu a imagem do banner (quality 60 → 50)
    // e mudou `src` em cinco páginas. Tratar isso como href reprovaria o PR.
    expect(severityOf(dom("DOM_ATTRIBUTE_CHANGED", { attribute: "src" }))).toBe("MEDIUM");
    expect(severityOf(dom("DOM_ATTRIBUTE_CHANGED", { attribute: "srcset" }))).toBe("LOW");
  });

  it("nó com texto que some é conteúdo perdido", () => {
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "li", carriesText: true })),
    ).toBe("HIGH");
  });

  it("invólucro sem texto que some é refatoração de estrutura", () => {
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "div", carriesText: false })),
    ).toBe("MEDIUM");
  });

  it("elemento interativo que some bloqueia mesmo sem texto", () => {
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "button", carriesText: false })),
    ).toBe("HIGH");
  });
});
