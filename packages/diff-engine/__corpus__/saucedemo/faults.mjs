/**
 * Corpus `saucedemo` — os defeitos, POR USUÁRIO.
 *
 * O Sauce Demo é uma loja de demonstração da Sauce Labs em que o mesmo app é
 * servido com defeitos deliberados conforme o usuário logado. A base é o
 * `standard_user`; cada outro usuário é uma "build head" com os defeitos
 * abaixo. Nenhum foi injetado por nós — são os que a Sauce Labs publica e que
 * a captura CONFIRMOU (medição antes de rotulagem, §10.3.1 da Fase 0): a
 * lista abaixo é o que apareceu no relatório e pôde ser atribuído a um
 * comportamento documentado, não a documentação copiada.
 *
 * `origem: "DEMO"` em todos: defeito real do app, mantido de propósito por quem
 * o publica. É um terceiro tipo além de HISTORICO e INJETADO.
 *
 * `pixel: true` marca defeito com efeito visual comprovado; delta VISUAL só é
 * atribuído a esses, na mesma observação (regra herdada do oscar).
 */

export const FAULTS_BY_USER = {
  locked_out_user: [
    {
      id: "L1-login-bloqueado",
      origem: "DEMO",
      descricao:
        "O login é recusado ('Sorry, this user has been locked out'). A jornada fica na tela de login: " +
        "a observação `inventory` é a própria tela de login com erro, e tudo depois dela não existe.",
      pixel: true,
    },
  ],
  problem_user: [
    {
      id: "P1-link-about-404",
      origem: "DEMO",
      descricao:
        "O link 'About' do menu lateral passa a apontar para saucelabs.com/error/404 em toda página.",
      pixel: false,
    },
    {
      id: "P2-sobrenome-ignorado",
      origem: "DEMO",
      descricao:
        "O campo Last Name do checkout ignora o que é digitado; Continue reprova ('Error: Last Name is required'). " +
        "A observação `checkout-overview` é a tela de informação com erro, e `complete` não existe.",
      pixel: true,
    },
    {
      id: "P3-imagens-404",
      origem: "DEMO",
      descricao: "Toda imagem de produto vira a mesma imagem de erro (sl-404, o cachorro).",
      pixel: true,
    },
    {
      id: "P4-ordenacao-ignorada",
      origem: "DEMO",
      descricao:
        "Selecionar 'Name (Z to A)' não reordena a lista: o rótulo do seletor volta a 'Name (A to Z)' e os " +
        "itens ficam na ordem original — o alinhamento por posição vê cada slot com outro produto.",
      pixel: true,
    },
  ],
  error_user: [
    {
      id: "E1-finish-nao-conclui",
      origem: "DEMO",
      descricao:
        "Clicar em Finish não conclui o pedido: a página fica no resumo, sem 'Thank you for your order', " +
        "e o app reporta o erro ao rastreador (backtrace).",
      pixel: true,
    },
    {
      id: "E2-ordenacao-quebrada",
      origem: "DEMO",
      descricao:
        "Ordenar lança erro ('Sorting is broken!'): a lista não reordena e o app reporta o erro ao rastreador — " +
        "o console mostra o POST de telemetria bloqueado por CORS.",
      pixel: true,
    },
    {
      id: "E3-erro-no-checkout",
      origem: "DEMO",
      descricao:
        "Durante o preenchimento do checkout o app reporta erro ao rastreador (backtrace 401 e CORS no console). " +
        "A causa exata não foi isolada; o sintoma é exclusivo deste usuário neste passo.",
      pixel: false,
    },
  ],
  visual_user: [
    {
      id: "V1-layout-desalinhado",
      origem: "DEMO",
      descricao:
        "Classes `visual_failure`, `align_right`, `btn_inventory_misalign`: ícones do menu e do carrinho fora " +
        "do lugar, nomes alinhados à direita, botão de compra deslocado.",
      pixel: true,
    },
    {
      id: "V2-precos-aleatorios",
      origem: "DEMO",
      descricao:
        "Os preços da listagem são outros ($29.99 vira $96.09): a tela renderiza, nada quebra, o valor está errado — " +
        "o problema do oráculo do §1 na camada de DOM.",
      pixel: true,
    },
    {
      id: "V3-imagem-404",
      origem: "DEMO",
      descricao: "A imagem da mochila vira a imagem de erro (sl-404).",
      pixel: true,
    },
  ],
};

export const USERS_WITH_FAULTS = Object.keys(FAULTS_BY_USER);
