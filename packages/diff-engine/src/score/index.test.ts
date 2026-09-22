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
    expect(severityOf(delta({ facts: { dataResource: true, thirdParty: false } }))).toBe("HIGH");
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
    expect(severityOf(delta({ facts: { dataResource: false, thirdParty: false } }))).toBe("MEDIUM");
  });

  // MEDIDO no piloto (juventude, rodada 2, run 32546926736): os prefetches da
  // home caíram na observação seguinte num lado e não no outro — app idêntico,
  // 4 REQUEST_REMOVED HIGH, PR bloqueado por timing de idle.
  it("prefetch do roteador que sumiu é timing, não regressão — nunca bloqueia", () => {
    expect(
      severityOf(
        delta({
          path: "GET /quem-somos?_rsc=<token>",
          facts: { dataResource: true, thirdParty: false, speculative: true },
        }),
      ),
    ).toBe("LOW");
  });

  it("contagem de prefetch que varia é timing também", () => {
    expect(
      severityOf(
        delta({
          kind: "REQUEST_COUNT_CHANGED",
          path: "GET /canais?_rsc=<token>",
          facts: { dataResource: true, thirdParty: false, speculative: true, amplification: 2 },
        }),
      ),
    ).toBe("LOW");
  });

  it("endpoint próprio SEM a marca especulativa continua HIGH — a classe é estreita", () => {
    expect(
      severityOf(delta({ facts: { dataResource: true, thirdParty: false, speculative: false } })),
    ).toBe("HIGH");
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
    expect(severityOf(dom("DOM_NODE_REMOVED", { tag: "li", carriesText: true }))).toBe("HIGH");
  });

  it("invólucro sem texto que some é refatoração de estrutura", () => {
    expect(severityOf(dom("DOM_NODE_REMOVED", { tag: "div", carriesText: false }))).toBe("MEDIUM");
  });

  it("elemento interativo SEM texto que some bloqueia — botão de ícone", () => {
    // É a única classe que esta condição cobre sozinha. Nenhum dos dois corpora
    // tem um caso dela, e foi por isso que a regra foi estreitada em vez de
    // removida: a ablação mostrou custo zero, não valor zero.
    expect(severityOf(dom("DOM_NODE_REMOVED", { tag: "button", carriesText: false }))).toBe("HIGH");
  });

  it("interativo COM texto é julgado pela regra de texto, não pela de interativo", () => {
    // ABLAÇÃO (2026-08-14, quatro pares reais): retirar `isInteractive` inteira
    // não mudava número nenhum — era redundante com `carriesText` em 100% dos
    // casos dos dois corpora. Este teste trava o estreitamento.
    expect(severityOf(dom("DOM_NODE_REMOVED", { tag: "a", carriesText: true }))).toBe("HIGH");
    // E uma reembalagem de elemento interativo passa a não bloquear — antes era
    // impossível, porque `isInteractive` devolvia HIGH antes de qualquer
    // verificação de texto preservado.
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "a", carriesText: true, textPreserved: true })),
    ).toBe("MEDIUM");
  });

  it("texto que só trocou de invólucro é reembalagem: reporta, não bloqueia", () => {
    // Commit real `1f2772c4b` do django-oscar: o texto sai de dentro de um <p>
    // e passa a ser filho direto do pai. Nada muda para quem olha a página.
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "p", carriesText: true, textPreserved: true })),
    ).toBe("MEDIUM");
  });

  it("conteúdo que some de verdade continua bloqueando", () => {
    expect(
      severityOf(dom("DOM_NODE_REMOVED", { tag: "li", carriesText: true, textPreserved: false })),
    ).toBe("HIGH");
  });
});

/**
 * A junta em que os DOIS corpora falhavam ao mesmo tempo — `F7` no `juventude`,
 * `O3` e `O7` no `oscar`. Todos são mudança de atributo com consequência
 * comportamental que o motor não inferia da mudança em si, e o que os três têm
 * em comum não é o nome do atributo: é o que a página deixa de fazer.
 *
 * MEDIDO em 2026-08-15 sobre oito pares: os predicados abaixo casam com 110
 * deltas nos dois pares de defeito — TODOS rotulados como regressão, nenhum
 * ruído — e com ZERO deltas nos seis pares sem defeito (dois PRs reais e quatro
 * pisos de ruído). Detecção 5/9 → 6/9 e 4/7 → 6/7, falso positivo inalterado.
 */
describe("severidade de DOM por consequência do atributo", () => {
  const attr = (
    kind: RawDelta["kind"],
    attribute: string,
    before: string | null,
    after: string | null,
  ): RawDelta =>
    delta({
      layer: "DOM",
      kind,
      path: `body > form > input@${attribute}`,
      before,
      after,
      facts: { tag: "input", attribute },
    });

  it("restrição de validação removida bloqueia — o formulário passou a aceitar o que recusava", () => {
    // `F7`: o campo de e-mail do formulário de contato perde `required`, e o
    // clube passa a receber mensagem sem remetente. Não muda um pixel.
    expect(severityOf(attr("DOM_ATTRIBUTE_REMOVED", "required", "", null))).toBe("HIGH");
    expect(severityOf(attr("DOM_ATTRIBUTE_REMOVED", "pattern", "[0-9]{4}", null))).toBe("HIGH");
  });

  it("restrição que só MUDA de valor não bloqueia — apertar e afrouxar são indistinguíveis aqui", () => {
    // `maxlength` de 200 para 10 aperta; de 10 para 200 afrouxa. Decidir qual
    // exigiria comparar números, e nenhum dos oito pares exercita o caso —
    // então a regra fica só na remoção, onde a barreira some inteira.
    expect(severityOf(attr("DOM_ATTRIBUTE_CHANGED", "maxlength", "200", "10"))).toBe("LOW");
    expect(severityOf(attr("DOM_ATTRIBUTE_CHANGED", "required", "", "required"))).toBe("MEDIUM");
  });

  it("valor que vira sentinela bloqueia — é ausência de dado vazando para a página", () => {
    // `O3`: `value=""` vira `value="None"` no campo escondido de busca do
    // catálogo; paginar passa a buscar pela palavra "None".
    expect(severityOf(attr("DOM_ATTRIBUTE_CHANGED", "value", "", "None"))).toBe("HIGH");
    expect(severityOf(attr("DOM_ATTRIBUTE_CHANGED", "data-total", "12", "undefined"))).toBe("HIGH");
    expect(severityOf(attr("DOM_ATTRIBUTE_ADDED", "value", null, "null"))).toBe("HIGH");
  });

  it("sentinela que já estava lá nos dois lados não produz delta, e sair dela não bloqueia", () => {
    // A correção do defeito é o caminho inverso, e ninguém deve ser reprovado
    // por ter consertado algo.
    expect(severityOf(attr("DOM_ATTRIBUTE_CHANGED", "value", "None", ""))).toBe("MEDIUM");
  });

  it("nome acessível PERDIDO bloqueia quando não sobra texto para anunciar", () => {
    // `O7`: a miniatura do produto perde `alt` em todas as listagens. Leitor de
    // tela passa a anunciar a imagem sem nome, e nada muda visualmente.
    expect(
      severityOf(
        delta({
          layer: "DOM",
          kind: "DOM_ACCESSIBLE_NAME_CHANGED",
          path: "body > ol > li > img[role=img]",
          before: "Applied cryptography",
          after: null,
          facts: { tag: "img", textFallback: false },
        }),
      ),
    ).toBe("HIGH");
  });

  it("nome acessível perdido NÃO bloqueia se o elemento ainda tem texto próprio", () => {
    // Um link que perde `aria-label` mas mantém o texto continua anunciável. É
    // esta distinção — o que sobrou — que separa rótulo trocado de elemento
    // anônimo, e não o nome do atributo que sumiu.
    expect(
      severityOf(
        delta({
          layer: "DOM",
          kind: "DOM_ACCESSIBLE_NAME_CHANGED",
          path: "body > a[role=link]",
          before: "Ver todas as turmas",
          after: null,
          facts: { tag: "a", textFallback: true },
        }),
      ),
    ).toBe("MEDIUM");
  });

  it("nome acessível que apenas TROCA é copy, não perda de função", () => {
    expect(
      severityOf(
        delta({
          layer: "DOM",
          kind: "DOM_ACCESSIBLE_NAME_CHANGED",
          path: "body > button[role=button]",
          before: "Enviar",
          after: "Enviar mensagem",
          facts: { tag: "button", textFallback: false },
        }),
      ),
    ).toBe("MEDIUM");
  });

  it("o atributo que CAUSOU a perda de nome continua LOW — o defeito não conta duas vezes", () => {
    expect(severityOf(attr("DOM_ATTRIBUTE_REMOVED", "alt", "Applied cryptography", null))).toBe(
      "LOW",
    );
  });
});
