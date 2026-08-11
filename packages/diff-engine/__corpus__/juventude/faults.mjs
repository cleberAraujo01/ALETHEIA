/**
 * Conjunto de defeitos do corpus `juventude` — a build `head` da medição de
 * saída da Fase 0.
 *
 * PROVENIÊNCIA IMPORTA MAIS QUE QUANTIDADE. Cada defeito declara sua origem:
 *
 *  - `HISTORICO` — o defeito **esteve em produção** nesta aplicação e foi
 *    corrigido por um commit real, cuja mensagem descreve o sintoma. Aqui ele é
 *    reconstituído no HEAD pela transformação inversa da correção. Não é
 *    hipótese sobre o que costuma quebrar: é o que quebrou.
 *  - `INJETADO` — falha plantada por nós, do tipo que este código realmente
 *    comporta (erro de digitação em rota, atributo de validação perdido, dígito
 *    trocado num contato, off-by-one em listagem). Não esteve em produção.
 *
 * Um relatório que somasse os dois e anunciasse "9 regressões reais" mentiria.
 * A medição reporta os dois números separados (PA-10).
 *
 * A escolha dos defeitos foi feita ANTES de olhar como o motor pontua cada tipo
 * de delta, por realismo e não por detectabilidade. Escolher defeito que o
 * motor já sabe pegar produziria um número bonito e vazio.
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

/** @type {readonly Fault[]} */
export const FAULTS = [
  {
    id: "F1-splash-global",
    origem: "HISTORICO",
    descricao:
      "O splash de abertura volta a montar o DOM em todas as páginas, não só na home. " +
      "Invisível para o usuário (o CSS o mantém oculto sem data-splash), mas o brasão " +
      "com priority volta a disputar a fila de download com a imagem do banner.",
    evidencia:
      "Corrigido por 56d5f9b e 71cbfed: 'O SplashIntro renderizava o DOM (invisivel) em " +
      "todas as paginas e o Image com priority emitia preload do brasao (34 KiB) furando " +
      "a fila na frente do banner (LCP) no 4G lento'.",
    rotasAfetadas: ["/escolinha", "/time", "/quem-somos", "/canais", "/contato", "/parceiros"],
    edits: [
      {
        file: "components/layout/SplashIntro.tsx",
        from: 'import { usePathname } from "next/navigation";\n',
        to: "",
      },
      {
        file: "components/layout/SplashIntro.tsx",
        from: "  const pathname = usePathname();\n",
        to: "",
      },
      {
        file: "components/layout/SplashIntro.tsx",
        from: '  if (pathname !== "/" || !ativo) return null;',
        to: "  if (!ativo) return null;",
      },
    ],
  },
  {
    id: "F2-contraste-aa",
    origem: "HISTORICO",
    descricao:
      "Texto pequeno volta a sair em paper (#F3F0EA) sobre vermelho vivo (#E4141B): " +
      "4,2:1, abaixo do mínimo AA de 4,5:1. Atinge os botões de chamada do site inteiro " +
      "e o botão 'Enviar mensagem' do formulário de contato.",
    evidencia:
      "Corrigido por bb8f391: 'Lighthouse (desktop) reprovou o botao Enviar mensagem: " +
      "texto paper sobre red fica em 4.2:1, abaixo do minimo AA de 4.5:1'.",
    rotasAfetadas: ["/", "/escolinha", "/time", "/quem-somos", "/canais", "/contato", "/parceiros"],
    edits: [
      {
        file: "components/ui/CtaLink.tsx",
        from: '  vermelho: "bg-red text-white shadow-md',
        to: '  vermelho: "bg-red text-paper shadow-md',
      },
      {
        file: "components/ui/CtaLink.tsx",
        from: '  claro: "border-2 border-white text-white hover:bg-white',
        to: '  claro: "border-2 border-white text-paper hover:bg-white',
      },
      {
        file: "components/contato/ContactForm.tsx",
        from: "text-sm font-bold uppercase tracking-widest text-white shadow-md",
        to: "text-sm font-bold uppercase tracking-widest text-paper shadow-md",
      },
    ],
  },
  {
    id: "F3-ticker-contraste",
    origem: "HISTORICO",
    descricao:
      "O selo 'Próximo jogo' do ticker volta ao vermelho puro: texto de 10px sobre red " +
      "fica abaixo do contraste AA. Aparece no topo de todas as páginas.",
    evidencia:
      "Corrigido por d5f3da6: 'Selo Proximo jogo do ticker: bg-red -> bg-red-ink, texto " +
      "de 10px sobre red puro ficava abaixo do contraste AA de 4.5:1'.",
    rotasAfetadas: ["/", "/escolinha", "/time", "/quem-somos", "/canais", "/contato", "/parceiros"],
    edits: [
      {
        file: "components/layout/TickerMarquee.tsx",
        from: "bg-red-ink px-3 py-1.5 text-[10px]",
        to: "bg-red px-3 py-1.5 text-[10px]",
      },
    ],
  },
  {
    id: "F4-mapa-eager",
    origem: "HISTORICO",
    descricao:
      "O embed do Google Maps volta a carregar junto com a página de contato, em vez de " +
      "esperar o clique. Puxa ~450 KB de JS de terceiro no carregamento inicial e o " +
      "cartão-fachada (com o botão 'Carregar mapa' e o atalho para o app) desaparece.",
    evidencia:
      "Corrigido por d5f3da6: 'Mapa do Google vira fachada com carregamento sob clique " +
      "(MapaLocal): tira ~450 KB de JS de terceiros do carregamento inicial da pagina'.",
    rotasAfetadas: ["/contato"],
    edits: [
      {
        file: "components/contato/MapaLocal.tsx",
        from: "const [carregado, setCarregado] = useState(false);",
        to: "const [carregado, setCarregado] = useState(true);",
      },
    ],
  },
  {
    id: "F5-banner-css",
    origem: "HISTORICO",
    descricao:
      "A foto do banner das páginas internas volta a ser background-image CSS: sai do " +
      "HTML (o preload scanner não a enxerga), perde as variantes por tamanho de tela e " +
      "volta a ser servida inteira para qualquer dispositivo.",
    evidencia:
      "Corrigido por f147fc8: 'A foto do PageBanner era background-image CSS: fora do " +
      "preload scanner e servida inteira (73 KiB) para qualquer tela'.",
    rotasAfetadas: ["/time", "/quem-somos", "/canais", "/contato", "/parceiros"],
    edits: [
      {
        file: "components/layout/PageBanner.tsx",
        from: 'import Image from "next/image";\n',
        to: "",
      },
      {
        file: "components/layout/PageBanner.tsx",
        from: `        <Image
          src={imagem}
          alt=""
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          quality={50}
          aria-hidden="true"
          className="object-cover"
          style={{ objectPosition: posicao }}
        />`,
        to: `        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: \`url(\${imagem})\`, backgroundPosition: posicao }}
        />`,
      },
    ],
  },
  {
    id: "F6-rota-quem-somos",
    origem: "INJETADO",
    descricao:
      "Erro de digitação no menu: o link 'Quem somos' passa a apontar para /quemsomos, " +
      "rota que não existe. O menu está em todas as páginas, então o site inteiro ganha " +
      "um link morto para uma página institucional.",
    evidencia:
      "Falha plantada. Classe clássica em navegação centralizada num arquivo de config: " +
      "o link some do radar porque a página continua existindo e ninguém clica no menu " +
      "durante o desenvolvimento.",
    rotasAfetadas: ["/", "/escolinha", "/time", "/quem-somos", "/canais", "/contato", "/parceiros"],
    edits: [
      {
        file: "config/site.ts",
        from: '{ href: "/quem-somos", label: "Quem somos" }',
        to: '{ href: "/quemsomos", label: "Quem somos" }',
      },
    ],
  },
  {
    id: "F7-email-sem-required",
    origem: "INJETADO",
    descricao:
      "O campo de e-mail do formulário de contato perde o atributo required: a validação " +
      "nativa do navegador deixa de barrar envio sem e-mail e o clube passa a receber " +
      "mensagem sem remetente para responder.",
    evidencia:
      "Falha plantada. Perda de atributo de validação em refatoração de formulário é " +
      "regressão funcional que não muda nada visualmente — invisível em revisão de código " +
      "e em inspeção visual.",
    rotasAfetadas: ["/contato"],
    edits: [
      {
        file: "components/contato/ContactForm.tsx",
        from: '            type="email"\n            required\n',
        to: '            type="email"\n',
      },
    ],
  },
  {
    id: "F8-whatsapp-digito",
    origem: "INJETADO",
    descricao:
      "Um dígito trocado no número de WhatsApp do clube (…6936 → …6939) em todos os " +
      "botões de matrícula e de apoio. A página renderiza, o botão funciona, a conversa " +
      "abre — com o número errado.",
    evidencia:
      "Falha plantada. É o caso central do problema do oráculo: nada falha, o valor é " +
      "que está errado. Nenhum teste de fluxo pega isso; só comparação contra a verdade " +
      "anterior.",
    rotasAfetadas: ["/", "/escolinha", "/parceiros", "/contato"],
    edits: [
      {
        file: "config/site.ts",
        from: "wa.me/5511941126936",
        to: "wa.me/5511941126939",
        all: true,
      },
    ],
  },
  {
    id: "F9-turmas-off-by-one",
    origem: "INJETADO",
    descricao:
      "Off-by-one na data layer: a última turma (Sub-16) some da listagem da escolinha e " +
      "das estatísticas derivadas dela. A página continua correta em tudo o mais.",
    evidencia:
      "Falha plantada. Perda silenciosa de item em listagem é a regressão que passa por " +
      "todo teste de fluxo: a página carrega, o layout está certo, falta um registro.",
    rotasAfetadas: ["/escolinha"],
    edits: [
      {
        file: "lib/content.ts",
        from: "export function getTurmas(): Turma[] {\n  return turmas;\n}",
        to: "export function getTurmas(): Turma[] {\n  return turmas.slice(0, turmas.length - 1);\n}",
      },
    ],
  },
];

export const FAULT_COUNT = {
  historico: FAULTS.filter((fault) => fault.origem === "HISTORICO").length,
  injetado: FAULTS.filter((fault) => fault.origem === "INJETADO").length,
  total: FAULTS.length,
};
