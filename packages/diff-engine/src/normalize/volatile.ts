/**
 * Catálogo de volatilidade — estágio 1 do pipeline (§12.4).
 *
 * Distinção que vale o produto inteiro:
 *
 *   NORMALIZAÇÃO (aqui) remove ruído **estrutural e provável por construção**:
 *   um UUID gerado a cada execução, a ordem de uma lista de classes CSS, um
 *   atributo interno de framework. Sem isso o motor não funciona — duas
 *   execuções da mesma build já divergiriam.
 *
 *   SUPRESSÃO (`../suppress/`) remove ruído **aprendido**, específico da
 *   aplicação do cliente, e exige evidência: no mínimo 3 casos reais rotulados
 *   como NOISE (§6.4 do CLAUDE.md).
 *
 * Confundir os dois é como se esconde uma regressão sem perceber. Cada regra
 * abaixo tem id e é contada no ledger — nada é silencioso.
 *
 * As classes de ruído aqui tratadas são exatamente as declaradas em
 * ARQUITETURA.md §12.4 ("IDs gerados, ordem de classes, atributos de
 * framework, timestamps, requestId, tokens").
 */

export const NORMALIZATION_RULES = {
  DOM_GENERATED_ATTRIBUTE_VALUE: "NORM-DOM-001",
  DOM_CLASS_ORDER: "NORM-DOM-002",
  DOM_HASHED_CLASS: "NORM-DOM-003",
  DOM_FRAMEWORK_ATTRIBUTE: "NORM-DOM-004",
  DOM_WHITESPACE: "NORM-DOM-005",
  DOM_TOKEN_FIELD_VALUE: "NORM-DOM-006",
  NET_PATH_IDENTIFIER: "NORM-NET-001",
  NET_VOLATILE_QUERY_PARAM: "NORM-NET-002",
  NET_QUERY_PARAM_ORDER: "NORM-NET-003",
  NET_VOLATILE_JSON_KEY: "NORM-NET-004",
  NET_UUID_VALUE: "NORM-NET-005",
  NET_TIMESTAMP_VALUE: "NORM-NET-006",
  NET_BUILD_CONTENT_HASH: "NORM-NET-007",
  NET_SINGLE_USE_TOKEN: "NORM-NET-008",
  NET_SESSION_PATH_PARAM: "NORM-NET-009",
  NET_OPAQUE_PATH_SEGMENT: "NORM-NET-010",
  NET_DEPLOY_IDENTITY: "NORM-NET-011",
  NET_DEPLOY_PLATFORM_FURNITURE: "NORM-NET-012",
} as const;

/** Marcadores que substituem o valor volátil. Visíveis no relatório de propósito. */
export const PLACEHOLDER = {
  TOKEN: "<token>",
  GENERATED: "<generated>",
  HASHED: "<hashed>",
  VOLATILE: "<volatile>",
  UUID: "<uuid>",
  TIMESTAMP: "<timestamp>",
  ID_SEGMENT: ":id",
  CONTENT_HASH: "<hash>",
  BUNDLE_CHUNK: "<chunk>",
  DEPLOY_ID: "<deploy-id>",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{32,}$/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Identificadores gerados por framework: MUI, React `useId`, Radix, etc. */
const FRAMEWORK_GENERATED_ID = [
  /^mui-\d+$/,
  /^:r[0-9a-z]+:$/i,
  /^«r[0-9a-z]+»$/i,
  /^radix-[0-9a-z]+$/i,
  /^headlessui-[a-z-]+-\d+$/i,
  /^:[a-z0-9]+:$/i,
];

/** Nomes de classe com hash de build: emotion, styled-components, CSS Modules. */
const HASHED_CLASS = [
  /^css-[0-9a-z]{5,}$/i,
  /^sc-[0-9A-Za-z]{5,}$/,
  /^[A-Za-z][\w-]*_[A-Za-z0-9-]+__[A-Za-z0-9]{4,}$/,
  /^[A-Za-z][\w-]*__[A-Za-z0-9]{6,}$/,
];

/**
 * Atributos internos de framework. Lista deliberadamente curta: cada entrada
 * aqui é informação que deixamos de comparar para sempre.
 */
const FRAMEWORK_ATTRIBUTES = [
  "data-reactid",
  "data-reactroot",
  "data-react-checksum",
  "data-svelte-h",
  "data-emotion",
  "data-styled",
  "nonce",
];

const FRAMEWORK_ATTRIBUTE_PREFIXES = ["data-v-", "data-astro-cid-", "data-n-"];

/**
 * Parâmetros de query usados como cache-buster. Só entram nomes sem significado
 * de negócio plausível — por isso `v` e `version` NÃO estão na lista.
 */
const VOLATILE_QUERY_PARAMS = new Set([
  "_",
  "cb",
  "cachebuster",
  "nonce",
  "t",
  "ts",
  "timestamp",
  "_t",
]);

/**
 * Parâmetros de uso único de fluxo de autenticação. O valor deles é criado por
 * request e morre no mesmo request: comparar dois é comparar dois números de
 * senha da fila.
 *
 * MEDIDO: duas capturas da MESMA build da tela de SSO da ANBIMA (Keycloak)
 * produziram dois deltas BLOQUEANTES — `tab_id` no link de "esqueci a senha" e
 * `session_code` no `action` do formulário. O `execution=<uuid>` ao lado deles
 * já era normalizado pela regra de UUID; estes dois escapavam por não terem
 * formato de UUID. Falso positivo em cima da mesma build é o pior tipo: destrói
 * a confiança no gate sem nem precisar de um deploy.
 *
 * O NOME SOZINHO NÃO BASTA, e é aqui que a regra quase virou falso negativo:
 * `state` é nome de parâmetro de OAuth **e** é `state=SP` numa aplicação
 * brasileira. Por isso normalizar exige nome desta lista **e** valor com cara
 * de token opaco (ver `isOpaqueToken`). `state=SP` continua sendo comparado.
 */
const SINGLE_USE_PROTOCOL_PARAMS = new Set([
  "state",
  "session_state",
  "session_code",
  "tab_id",
  "execution",
  "code_challenge",
  "code_verifier",
  "auth_session_id",
  "login_session_id",
  "request_uri",
]);

/**
 * Campo de formulário que carrega token anti-CSRF. O valor é criado por sessão
 * e não atravessa duas execuções nem na mesma build.
 *
 * MEDIDO: duas capturas da MESMA build do sandbox do django-oscar produziram
 * 104 deltas, 95 deles o `value` do `csrfmiddlewaretoken` — um por formulário,
 * em nove páginas. Nenhum bloqueava (é `value`, não `href`), e é justamente por
 * isso que o caso importa: ruído que não bloqueia não derruba o gate, mas
 * afoga o relatório de triagem. Defeito real num app com formulário em toda
 * página entraria numa lista onde 91% das linhas são token.
 *
 * A lista cobre o campo que cada framework emite, porque o nome é fixado pelo
 * framework e não por quem escreve a aplicação. `token` sozinho ficou de fora:
 * é nome plausível de campo de negócio (token de cupom, de convite).
 */
const TOKEN_FIELD_NAMES = new Set([
  "csrfmiddlewaretoken", // Django
  "csrftoken",
  "csrf",
  "xsrf",
  "xsrftoken",
  "authenticitytoken", // Rails
  "requestverificationtoken", // ASP.NET, emitido como __RequestVerificationToken
]);

export function isTokenFieldName(name: string): boolean {
  return TOKEN_FIELD_NAMES.has(normalizeKey(name));
}

/**
 * Identidade de sessão embutida no PATH, como parâmetro de segmento
 * (`;jsessionid=…`, RFC 3986 §3.3) — o rewriting de URL que contêiner de
 * Servlet aplica a **toda** URL da página quando não pode contar com cookie.
 *
 * MEDIDO: duas capturas da MESMA build do ParaBank (Java/JSP, hospedado)
 * produziram 44 deltas, 28 deles BLOQUEANTES, e 100% tinham esta única causa. É
 * pior que o caso Keycloak porque não fica num parâmetro de fluxo de
 * autenticação: contamina `href`, `src`, `action` e a URL de todo recurso
 * estático, então também quebra o ALINHAMENTO de rede — os mesmos 6 recursos
 * apareceram como 6 removidos e 6 adicionados, e o diff de corpo, que é onde
 * mora o valor, nunca aconteceu.
 *
 * NORMALIZA NOS DOIS PROPÓSITOS, e isso é deliberadamente o oposto do que se
 * faz com identificador de path (§4 da medição, o WhatsApp com um dígito
 * trocado). Lá, apagar o id no propósito `VALUE` custava detecção, porque o id
 * era conteúdo de negócio. Aqui não existe esse risco: id de sessão é criado
 * pelo contêiner por sessão, nunca é escrito por ninguém e não sobrevive a duas
 * execuções nem na mesma build. Não há o que comparar.
 *
 * A conjunção nome+forma segue a mesma disciplina de `isSingleUseProtocolValue`.
 * A lista fica curta de propósito: só nome que contêiner emite. `sid` ficou de
 * fora por ser plausível como identificador de negócio, e ColdFusion
 * (`cfid`/`cftoken`) também, porque não temos como medir — entrada não testada
 * é dívida, não cobertura.
 */
const CONTAINER_SESSION_PATH_PARAMS = new Set(["jsessionid", "phpsessid", "sessionid"]);

/**
 * Segmento de caminho opaco: `/ads/click/x/GTND427YCAYD623ICV7LYKQUFTSIVK7UF6…`
 * (112 caracteres), o token por impressão que um widget de anúncio põe no
 * `href` do clique.
 *
 * MEDIDO em vite.dev (quinta aplicação de piso): duas capturas da mesma
 * produção, 14 deltas bloqueantes — todos `href` → HIGH em cima deste token,
 * dois por página. A regra de `href` está certa (é ela que pega o WhatsApp
 * errado do `juventude`); o que falta é reconhecer que isto não é destino,
 * é identidade de impressão.
 *
 * Aqui não há nome para fazer conjunção — é um segmento solto. Então a forma
 * precisa ser inconfundível sozinha, e por isso ela é bem mais estreita que
 * `isOpaqueToken`:
 *
 *  - ≥ 32 caracteres SEM separador (`-`, `_`, `.`): slug legível tem
 *    separador (`iphone-15-pro-max-256gb`), e é slug que aparece no `href` de
 *    produto, categoria e artigo — o conteúdo que a lição do WhatsApp manda
 *    continuar comparando;
 *  - só `[A-Za-z0-9]`, com dígito E letra fora do hexadecimal: número puro
 *    (telefone, id) fica de fora; hash hexadecimal fica com as regras que já o
 *    tratam (`NORM-NET-001` no alinhamento, comparado como valor), porque um
 *    hash de conteúdo em `href` (avatar, artefato) ainda diz alguma coisa.
 *
 * Vale nos dois propósitos: no `href` (VALUE) porque foi lá que bloqueou; no
 * alinhamento porque uma requisição com este segmento nunca emparelharia.
 */
export function isOpaquePathSegment(segment: string): boolean {
  return /^[A-Za-z0-9]{32,}$/.test(segment) && /[G-Zg-z]/.test(segment) && /\d/.test(segment);
}

/**
 * Identidade de deploy declarada pelo próprio framework.
 *
 * O Next.js emite o buildId — um token novo A CADA deploy, mesmo com código
 * idêntico — em posição estrutural fixa: o comentário imediatamente após o
 * doctype (`<!DOCTYPE html><!--QtLyQumOsnLxPnzpPW71C-->`). O mesmo token
 * reaparece no flight data RSC (`"b":"<token>"`) de todo documento e de toda
 * resposta `?_rsc=`.
 *
 * MEDIDO no primeiro par real do piloto (juventude, preview × produção na
 * Vercel, PR #2 — um PR que só tocava README): dos 45 deltas do relatório, 38
 * eram RESPONSE_FIELD_CHANGED cuja divergência inteira era este token. Não é
 * ruído de app, é ruído de PLATAFORMA: qualquer cliente Next.js em qualquer
 * host produz o mesmo padrão em todo PR — por isso é normalização, não
 * supressão aprendida (que é por aplicação e exige 3 execuções).
 *
 * A extração é por DECLARAÇÃO, não por adivinhação: só reconhecemos o token
 * que o framework afixou na posição estrutural. Nada com espaço, nada curto,
 * e exige dígito E letra — `<!--app-html-->` (marcador de template do Vite) e
 * comentários escritos por gente não casam. O que se mascara depois é a
 * ocorrência LITERAL desse token extraído, lado a lado com o seu par — se a
 * aplicação exibir o próprio buildId na tela, mascará-lo continua correto,
 * porque ele É o buildId.
 */
const NEXTJS_BUILD_ID_COMMENT = /^<!doctype html><!--([A-Za-z0-9_-]{16,32})-->/i;

export function extractDeployIdentity(documentBody: string): string | null {
  const match = NEXTJS_BUILD_ID_COMMENT.exec(documentBody);
  const token = match?.[1];
  if (token === undefined) return null;
  if (!(/[A-Za-z]/.test(token) && /\d/.test(token))) return null;
  return token;
}

/**
 * Mobília que a PLATAFORMA DE DEPLOY injeta num dos lados do par — não é a
 * aplicação, e só existe num dos ambientes por construção.
 *
 * MEDIDO no mesmo par do piloto: os outros 7 deltas (um REQUEST_ADDED por
 * observação) eram `https://vercel.live/_next-live/feedback/feedback.js` — o
 * toolbar de feedback que a Vercel injeta SOMENTE em preview. Produção nunca
 * o tem; comparar preview com produção sempre o acusa.
 *
 * A lista é curta de propósito e por HOST EXATO: `vercel.live` é domínio da
 * Vercel, nunca serve conteúdo da aplicação do cliente, e portanto removê-lo
 * não pode esconder regressão do app. Injeção de outra plataforma (Netlify e
 * afins) só entra quando um par real a mostrar — entrada não medida é dívida,
 * não cobertura.
 */
const DEPLOY_PLATFORM_HOSTS = new Set(["vercel.live"]);

export function isDeployPlatformFurniture(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      DEPLOY_PLATFORM_HOSTS.has(host) ||
      [...DEPLOY_PLATFORM_HOSTS].some((h) => host.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

export function isContainerSessionPathParam(name: string, value: string): boolean {
  if (!CONTAINER_SESSION_PATH_PARAMS.has(name.toLowerCase())) return false;
  // O `.` do alfabeto cobre o sufixo de jvmRoute que o Tomcat anexa em cluster
  // (`…C8CE751.node1`).
  return /^[A-Za-z0-9_.~-]{8,}$/.test(value);
}

/**
 * Cadeia opaca: alfabeto de token (base64url), comprimento que nenhum humano
 * digita e mistura de letras e dígitos.
 *
 * O PISO DE 20 CARACTERES TEM MOTIVO CONCRETO: id de vídeo do YouTube tem
 * exatamente 11 caracteres deste mesmo alfabeto. Um piso menor apagaria a troca
 * de um vídeo na página — e a aplicação do corpus `juventude` tem uma grade de
 * vídeos do YouTube. Seria falso negativo criado para resolver falso positivo.
 *
 * Abaixo de 20 caracteres, só normaliza se o NOME do parâmetro também disser
 * que é token de protocolo (é o caso do `tab_id`, com 11).
 */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Chaves de JSON reconhecidamente de infraestrutura.
 *
 * `duration` foi deliberadamente EXCLUÍDA: é nome plausível de campo de
 * negócio (duração de assinatura, de plano, de sessão contratada), e normalizar
 * um campo de negócio é falso negativo silencioso.
 */
const VOLATILE_JSON_KEYS = new Set([
  "requestid",
  "traceid",
  "correlationid",
  "spanid",
  "sessionid",
  "nonce",
  "etag",
  "csrf",
  "csrftoken",
  "xsrf",
  "xsrftoken",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "timestamp",
  "createdat",
  "updatedat",
  "modifiedat",
  "expiresat",
  "expiresin",
  "issuedat",
  "iat",
  "exp",
  "jti",
  "servertime",
  "responsetime",
  "elapsedms",
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, "");

export function isVolatileJsonKey(key: string): boolean {
  return VOLATILE_JSON_KEYS.has(normalizeKey(key));
}

export function isVolatileQueryParam(name: string): boolean {
  return VOLATILE_QUERY_PARAMS.has(name.toLowerCase());
}

/** Cadeia sem forma legível: alfabeto de token, ≥ 20 caracteres, letra e dígito. */
export function isOpaqueToken(value: string): boolean {
  return OPAQUE_TOKEN.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

/**
 * O par nome+valor caracteriza token de uso único de protocolo?
 *
 * Conjunção deliberada: nome de protocolo com valor curto e legível (`state=SP`)
 * continua sendo comparado; valor opaco em parâmetro de negócio também. Só sai
 * do diff o que é as duas coisas ao mesmo tempo.
 */
export function isSingleUseProtocolValue(name: string, value: string): boolean {
  if (!SINGLE_USE_PROTOCOL_PARAMS.has(name.toLowerCase())) return false;
  return /^[A-Za-z0-9_.~-]{8,}$/.test(value);
}

export function isFrameworkAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FRAMEWORK_ATTRIBUTES.includes(lower) ||
    FRAMEWORK_ATTRIBUTE_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function isGeneratedIdentifier(value: string): boolean {
  return (
    UUID.test(value) || LONG_HEX.test(value) || FRAMEWORK_GENERATED_ID.some((re) => re.test(value))
  );
}

export function isHashedClassName(value: string): boolean {
  return HASHED_CLASS.some((re) => re.test(value));
}

export function isUuid(value: string): boolean {
  return UUID.test(value) || LONG_HEX.test(value);
}

export function isIsoTimestamp(value: string): boolean {
  return ISO_DATETIME.test(value);
}

/**
 * Segmento de path que é identificador de recurso.
 *
 * Numérico puro conta como identificador: `/orders/1042` e `/orders/1043` são a
 * mesma rota. Isso é alinhamento, não supressão — o valor do id continua
 * visível no diff de corpo de resposta.
 */
export function isIdentifierPathSegment(segment: string): boolean {
  return isGeneratedIdentifier(segment) || /^\d+$/.test(segment);
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Nome de arquivo de bundle: `page-4f2a…8c.js`, `main.a1b2c3d4.css`,
 * `index-DkG7f8Xz.js`, `528-9d84e3b3ba6f7f01.js`.
 *
 * O hash é função do CONTEÚDO do build: qualquer linha alterada em qualquer
 * lugar troca o nome de vários arquivos de uma vez. Sem esta regra, todo PR que
 * encosta no código produz dezenas de "requisição sumiu / requisição
 * apareceu" que não dizem nada além de "o bundler rodou".
 *
 * MEDIDO no corpus real `juventude`: das 177 divergências de rede entre duas
 * builds, 110 eram exatamente isto — 62% do ruído de rede vindo do bundler.
 *
 * Duas contenções para não virar cegueira:
 *
 *  - só extensões de código, estilo, mapa e fonte. Imagem fica de fora de
 *    propósito: trocar `banner-antigo.webp` por `banner-novo.webp` é mudança
 *    de conteúdo, e o produto precisa ver;
 *  - o arquivo que **desaparece** continua aparecendo, porque o nome sem hash
 *    continua distinto (`layout-<hash>.js` ≠ `page-<hash>.js`).
 *
 * O identificador numérico de chunk (`528-…`, `986-…`) é caso à parte: é
 * posição no grafo de módulos do bundler, renumerada a cada build. Não existe
 * "o chunk 528" atravessando duas builds, então o número também sai.
 */
const BUNDLE_ASSET = /^(.+?)[.-]([0-9A-Za-z_-]{8,})\.(js|mjs|cjs|css|map|woff2?|ttf|otf)$/;
const NUMERIC_CHUNK = /^\d+$/;

export function stripContentHash(segment: string): string {
  const match = BUNDLE_ASSET.exec(segment);
  if (match === null) return segment;

  const [, name, hash, extension] = match;
  if (name === undefined || hash === undefined || extension === undefined) return segment;
  // Exige dígito no hash: separa `main.a1b2c3d4.js` de `plugin.controller.js`,
  // onde o "hash" seria uma palavra e o arquivo, escrito por uma pessoa.
  if (!/\d/.test(hash)) return segment;

  const stableName = NUMERIC_CHUNK.test(name) ? PLACEHOLDER.BUNDLE_CHUNK : name;
  return `${stableName}-${PLACEHOLDER.CONTENT_HASH}.${extension}`;
}
