/**
 * Corpus de MUDANÇA INTENCIONAL do `oscar` — o par legítimo, sem defeito
 * nenhum. É o análogo do par `pr-antes` × `base` do corpus `juventude`.
 *
 * POR QUE ELE EXISTE. Um corpus onde toda diferença é defeito não consegue
 * dizer nada sobre falso positivo: detectar tudo é trivial se reprovar todo
 * mundo for aceitável. E piso de ruído (duas capturas da mesma build) também
 * não serve — mesma build não é PR. O número que interessa aqui é **quantos
 * deltas bloqueantes o motor levanta contra alguém que não errou**, e a
 * resposta aceitável é zero.
 *
 * O QUE SÃO ESTAS MUDANÇAS. Quatro alterações reais, mescladas no django-oscar
 * entre 2020 e 2024, todas confinadas a template e todas visíveis na jornada da
 * Fase 0. Nenhuma é correção de bug: são refinamento de menu, de identidade de
 * campo, de classe de imagem e de regra de disponibilidade. É o tipo de coisa
 * que chega num PR de upgrade de versão.
 *
 * COMO SÃO RECONSTITUÍDAS. `apply-intentional.mjs` aplica a **transformação
 * inversa** sobre o template atual, produzindo a build `pr-antes`; a build
 * `pr-depois` é o template como está. A alternativa — dar checkout no arquivo
 * inteiro na época — arrastaria junto tudo que mudou nele depois, e aí o diff
 * não seria mais o destas mudanças. Mesma técnica dos defeitos `HISTORICO` de
 * `faults.mjs`, pelo mesmo motivo.
 *
 * UMA CANDIDATA FOI VERIFICADA ANTES DE ENTRAR. `1f2772c4b` só se manifesta se
 * existir produto sem preço; o sandbox tem 3 em 201, então ela produz efeito
 * observável e vale. Se tivesse zero, entraria na lista de descartadas de
 * `faults.mjs` — mudança que não muda nada não testa nada.
 */

/**
 * @typedef {Object} ChangeEdit
 * @property {string} file    Caminho relativo à raiz da aplicação.
 * @property {string} from    Trecho no template ATUAL (build `pr-depois`).
 * @property {string} to      Como era ANTES da mudança (build `pr-antes`).
 * @property {boolean} [all]  Substituir todas as ocorrências.
 */

/**
 * @typedef {Object} IntentionalChange
 * @property {string} id
 * @property {string} commit         Commit real do django-oscar que a introduziu.
 * @property {string} descricao      O que muda na página, do ponto de vista de quem olha.
 * @property {string} porQueLegitima Por que isto NÃO é defeito.
 * @property {readonly ChangeEdit[]} edits
 */

const TEMPLATES = "src/oscar/templates/oscar";

/** @type {readonly IntentionalChange[]} */
export const CHANGES = [
  {
    id: "M1-menu-so-nivel-1",
    commit: "cbfd74234 — 'Render only top level categories in primary navigation menu.' (2020-10-30)",
    descricao:
      "O menu 'Browse store' deixa de listar as categorias de segundo nível e passa a " +
      "mostrar só as de primeiro. Em toda página da loja, vários links com texto " +
      "DESAPARECEM do cabeçalho.",
    porQueLegitima:
      "Decisão de navegação, mesclada upstream. É o adversário mais duro que este corpus " +
      "tem: a regra 'nó com texto removido → HIGH' é uma das duas que fecharam a Fase 0, e " +
      "aqui ela encontra remoção de texto que NÃO é regressão. Se o gate reprovar isto, a " +
      "regra está errada — foi exatamente o cenário que a §7 da medição previu.",
    edits: [
      {
        file: `${TEMPLATES}/partials/nav_primary.html`,
        from: "{% category_tree depth=1 as tree_categories %}",
        to: "{% category_tree depth=2 as tree_categories %}",
      },
    ],
  },
  {
    id: "M2-id-no-campo-de-busca",
    commit: "fddb6a312 — 'Add id to search form input' (2024-02-16)",
    descricao:
      "O campo de busca do cabeçalho ganha `id=\"id_q\"`. Aparece em toda página; nada muda " +
      "visualmente.",
    porQueLegitima:
      "Acréscimo de identidade para acessibilidade e teste. Adversário específico do " +
      "ALINHAMENTO: `id` está na lista de atributos de identidade do motor, então um `id` " +
      "que aparece do nada pode fazer o nó deixar de casar com o seu par na base e virar " +
      "'sumiu um, apareceu outro' em vez de um único atributo acrescentado.",
    edits: [
      {
        file: `${TEMPLATES}/partials/search.html`,
        from: '<input class="form-control mr-sm-2" name="q" id="id_q" placeholder=',
        to: '<input class="form-control mr-sm-2" name="q" placeholder=',
      },
    ],
  },
  {
    id: "M3-imagem-responsiva-na-galeria",
    commit: "83dda118c — 'Add Bootstrap responsive image class' (2023-10-30)",
    descricao:
      "As três imagens da galeria da página de produto ganham a classe `img-fluid`. Com " +
      "Bootstrap carregado, isso muda como elas escalam.",
    porQueLegitima:
      "Ajuste de responsividade. Mudança de classe com efeito visual real — o par de " +
      "camadas (DOM e pixel) precisa concordar que isto não é regressão.",
    edits: [
      {
        file: `${TEMPLATES}/catalogue/partials/gallery.html`,
        from: '<img src="{{ thumb.url }}" class="img-fluid" alt="{{ product.get_title }}" />',
        to: '<img src="{{ thumb.url }}" alt="{{ product.get_title }}" />',
        all: true,
      },
    ],
  },
  {
    id: "M4-sem-preco-nao-compra",
    commit: "1f2772c4b — 'Don't allow adding to basket if the product has no price.' (#4013, 2023-05-12)",
    descricao:
      "Produto sem preço deixa de exibir disponibilidade e botão de compra, e passa a " +
      "mostrar 'Unavailable'. O sandbox tem 3 produtos assim em 201.",
    porQueLegitima:
      "Correção de regra de negócio mesclada upstream — mudança de comportamento desejada. " +
      "Para o motor é indistinguível, em forma, de um defeito: some conteúdo de alguns " +
      "cards e aparece outro. É o caso que separa 'mudou' de 'quebrou', e o motor não tem " +
      "como decidir isso sozinho: ele deve MOSTRAR, não bloquear.",
    edits: [
      {
        file: `${TEMPLATES}/catalogue/partials/add_to_basket_form.html`,
        from: "{% if session.availability.is_available_to_buy and session.price.exists %}",
        to: "{% if session.availability.is_available_to_buy %}",
      },
      {
        file: `${TEMPLATES}/catalogue/partials/add_to_basket_form_compact.html`,
        from: "{% if session.availability.is_available_to_buy and session.price.exists %}",
        to: "{% if session.availability.is_available_to_buy %}",
      },
      {
        file: `${TEMPLATES}/catalogue/partials/stock_record.html`,
        from:
          '{% endif %}\n{% if session.price.exists %}\n<p class="{{ session.availability.code }} availability">',
        to: '{% endif %}\n<p class="{{ session.availability.code }} availability">',
      },
      {
        file: `${TEMPLATES}/catalogue/partials/stock_record.html`,
        from: "</p>\n{% else %}\n    <i class=\"fas fa-ban\"></i>\n    {% trans 'Unavailable' %}\n{% endif %}",
        to: "</p>",
      },
    ],
  },
];

export const CHANGE_COUNT = CHANGES.length;
