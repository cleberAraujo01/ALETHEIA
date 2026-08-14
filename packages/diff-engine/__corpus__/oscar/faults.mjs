/**
 * Conjunto de defeitos do corpus `oscar` — o segundo corpus da Fase 0, pedido
 * pela §7 do relatório de medição.
 *
 * A aplicação é o sandbox do django-oscar: e-commerce Python/Django, renderizado
 * no servidor, com token CSRF em todo formulário. Não a escrevemos, não a
 * calibramos, e ela não tem parentesco nenhum com a aplicação do corpus
 * `juventude` (Next.js). É esse estranhamento que dá valor ao número.
 *
 * PROVENIÊNCIA IMPORTA MAIS QUE QUANTIDADE, como no primeiro corpus:
 *
 *  - `HISTORICO` — esteve em produção **nesta aplicação**, corrigido por commit
 *    real cuja mensagem descreve o sintoma, e aqui reconstituído no HEAD pela
 *    transformação inversa da correção. Diferença relevante em relação ao corpus
 *    `juventude`: lá os commits eram nossos, aqui são de terceiros, escritos
 *    anos antes de este motor existir. Ninguém os escolheu pensando em diff.
 *  - `INJETADO` — plantado por nós, do tipo que este código comporta.
 *
 * DOIS CANDIDATOS FORAM DESCARTADOS DEPOIS DE MEDIDOS, e o registro fica porque
 * escolher defeito por detectabilidade é como se produz número bonito e vazio:
 *
 *  - preço exibido sem imposto (`incl_tax` → `excl_tax`): no sandbox o imposto é
 *    zero, então os dois valores são idênticos e a troca não muda **nada** na
 *    página. Não é defeito invisível para o motor — é defeito que não existe
 *    nesta build;
 *  - botão "voltar" da página de produto (corrigido por 8aba6abe4): só renderiza
 *    quando há referrer, e a jornada da Fase 0 navega direto por URL.
 */

/**
 * @typedef {Object} FaultEdit
 * @property {string} file    Caminho relativo à raiz da aplicação.
 * @property {string} from    Trecho exato a substituir.
 * @property {string} to      Substituto.
 * @property {boolean} [all]  Substituir todas as ocorrências (default: exige uma só).
 */

/**
 * @typedef {Object} Fault
 * @property {string} id
 * @property {"HISTORICO" | "INJETADO"} origem
 * @property {string} descricao      O sintoma, como o usuário o percebe.
 * @property {string} evidencia      Commit que corrigiu (HISTORICO) ou justificativa (INJETADO).
 * @property {readonly string[]} rotasAfetadas
 * @property {readonly FaultEdit[]} edits
 */

const TEMPLATES = "src/oscar/templates/oscar";

/** @type {readonly Fault[]} */
export const FAULTS = [
  {
    id: "O1-paginacao-acumula-page",
    origem: "HISTORICO",
    descricao:
      "Os links 'anterior' e 'próxima' da paginação voltam a carregar o parâmetro `page` " +
      "da página atual junto com o novo: a partir da página 2 o href vira " +
      "`?page=2&page=3`. O usuário clica em 'próxima' e o servidor resolve o primeiro " +
      "`page`, então a navegação trava na página em que ele já estava.",
    evidencia:
      'Corrigido pelo commit c1951d58d do django-oscar, \'Fix "page" query parameter in ' +
      "pagination templates': a tag recebia `page` sem aspas, resolvido como variável " +
      "inexistente (string vazia), então nenhum parâmetro era excluído da querystring.",
    rotasAfetadas: ["/en-gb/catalogue/?page=2"],
    edits: [
      {
        file: `${TEMPLATES}/partials/pagination.html`,
        from: "{% get_parameters 'page' %}",
        to: "{% get_parameters page %}",
        all: true,
      },
    ],
  },
  {
    id: "O2-categorias-empilhadas",
    origem: "HISTORICO",
    descricao:
      "A lista lateral de categorias do catálogo perde o empilhamento e volta a renderizar " +
      "os itens lado a lado, transbordando o cartão em telas estreitas.",
    evidencia:
      "Corrigido pelo commit 27fe44a17 do django-oscar (#3772), 'Fix stacked display of " +
      "categories without children in catalogue browse template'.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
    ],
    edits: [
      {
        file: `${TEMPLATES}/catalogue/browse.html`,
        from: '<ul class="nav nav-list flex-column">',
        to: '<ul class="nav nav-list">',
      },
    ],
  },
  {
    id: "O3-busca-oculta-none",
    origem: "HISTORICO",
    descricao:
      "O campo escondido que preserva o termo de busca ao paginar volta a renderizar a " +
      "string literal 'None' quando não há busca ativa. Quem navega o catálogo e usa a " +
      "paginação passa a submeter uma busca pela palavra 'None'.",
    evidencia:
      "Corrigido pelo commit e6496c7e6 do django-oscar, 'Fix rendering of empty value in " +
      'hidden search form in catalogue view\': faltava `|default_if_none:""`, e o ' +
      "template renderia a representação do `None` do Python.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
    ],
    edits: [
      {
        file: `${TEMPLATES}/catalogue/browse.html`,
        from: '<input type="hidden" name="q" value="{{ search_form.q.value|default_if_none:"" }}" />',
        to: '<input type="hidden" name="q" value="{{ search_form.q.value }}" />',
      },
    ],
  },
  {
    id: "O4-rota-ofertas-quebrada",
    origem: "INJETADO",
    descricao:
      "Erro de digitação no menu principal: o link 'Offers' passa a apontar para " +
      "/en-gb/offer/, rota que não existe (a correta é /en-gb/offers/). O menu está em " +
      "todas as páginas, então a loja inteira ganha um link morto.",
    evidencia:
      "Falha plantada. Mesma classe do defeito F6 do corpus `juventude`, aqui reproduzida " +
      "noutra stack: o link some do radar porque a página continua existindo e ninguém " +
      "clica no menu durante o desenvolvimento.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
      "/en-gb/catalogue/snow-crash_12/",
      "/en-gb/catalogue/little-brother_29/",
      "/en-gb/search/?q=security",
      "/en-gb/basket/",
      "/en-gb/offers/",
      "/en-gb/accounts/login/",
    ],
    edits: [
      {
        file: `${TEMPLATES}/partials/nav_primary.html`,
        from: '<a class="dropdown-item" href="{% url \'offer:list\' %}">',
        to: '<a class="dropdown-item" href="/en-gb/offer/">',
      },
    ],
  },
  {
    id: "O5-busca-action-errado",
    origem: "INJETADO",
    descricao:
      "O formulário de busca do cabeçalho passa a submeter para o índice do catálogo em " +
      "vez da rota de busca. O campo aceita o texto, o botão funciona, a página responde " +
      "200 — e o termo é silenciosamente ignorado.",
    evidencia:
      "Falha plantada. Destino de ação do usuário trocado é exatamente a classe que a " +
      "regra `href`/`action` → HIGH existe para pegar; o corpus precisa conter um caso " +
      "dela numa aplicação contra a qual a regra não foi calibrada.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
      "/en-gb/catalogue/snow-crash_12/",
      "/en-gb/catalogue/little-brother_29/",
      "/en-gb/search/?q=security",
      "/en-gb/basket/",
      "/en-gb/offers/",
      "/en-gb/accounts/login/",
    ],
    edits: [
      {
        file: `${TEMPLATES}/partials/search.html`,
        from: "action=\"{% url 'search:search' %}\"",
        to: "action=\"{% url 'catalogue:index' %}\"",
      },
    ],
  },
  {
    id: "O6-listagem-off-by-one",
    origem: "INJETADO",
    descricao:
      "Off-by-one na listagem do catálogo: o último produto de cada página some. A página " +
      "carrega, o layout está certo, a paginação continua dizendo o total correto — falta " +
      "um produto.",
    evidencia:
      "Falha plantada. Mesma classe do defeito F9 do corpus `juventude`. Perda silenciosa " +
      "de item em listagem passa por todo teste de fluxo, e numa loja significa produto " +
      "que não pode ser vendido.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
    ],
    edits: [
      {
        file: `${TEMPLATES}/catalogue/browse.html`,
        from: "{% for product in products %}",
        to: "{% for product in products|slice:':-1' %}",
      },
    ],
  },
  {
    id: "O7-miniatura-sem-alt",
    origem: "INJETADO",
    descricao:
      "A miniatura do produto perde o atributo alt nas listagens. Nada muda visualmente; " +
      "leitor de tela passa a anunciar a imagem sem nome, e todo card de produto do " +
      "catálogo fica sem alternativa textual.",
    evidencia:
      "Falha plantada. Mesma classe do defeito F7 do corpus `juventude` (atributo perdido " +
      "em refatoração): regressão funcional que não muda pixel nenhum, invisível em " +
      "revisão de código e em inspeção visual.",
    rotasAfetadas: [
      "/en-gb/catalogue/",
      "/en-gb/catalogue/?page=2",
      "/en-gb/catalogue/category/books_2/",
      "/en-gb/catalogue/category/clothing_1/",
      "/en-gb/search/?q=security",
    ],
    edits: [
      {
        file: `${TEMPLATES}/catalogue/partials/product.html`,
        from: '<img src="{{ thumb.url }}" alt="{{ product.get_title }}" class="img-thumbnail w-auto mx-auto my-0">',
        to: '<img src="{{ thumb.url }}" class="img-thumbnail w-auto mx-auto my-0">',
      },
    ],
  },
];

export const FAULT_COUNT = {
  historico: FAULTS.filter((fault) => fault.origem === "HISTORICO").length,
  injetado: FAULTS.filter((fault) => fault.origem === "INJETADO").length,
  total: FAULTS.length,
};
