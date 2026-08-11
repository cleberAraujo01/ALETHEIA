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
  NET_PATH_IDENTIFIER: "NORM-NET-001",
  NET_VOLATILE_QUERY_PARAM: "NORM-NET-002",
  NET_QUERY_PARAM_ORDER: "NORM-NET-003",
  NET_VOLATILE_JSON_KEY: "NORM-NET-004",
  NET_UUID_VALUE: "NORM-NET-005",
  NET_TIMESTAMP_VALUE: "NORM-NET-006",
  NET_BUILD_CONTENT_HASH: "NORM-NET-007",
} as const;

/** Marcadores que substituem o valor volátil. Visíveis no relatório de propósito. */
export const PLACEHOLDER = {
  GENERATED: "<generated>",
  HASHED: "<hashed>",
  VOLATILE: "<volatile>",
  UUID: "<uuid>",
  TIMESTAMP: "<timestamp>",
  ID_SEGMENT: ":id",
  CONTENT_HASH: "<hash>",
  BUNDLE_CHUNK: "<chunk>",
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
const VOLATILE_QUERY_PARAMS = new Set(["_", "cb", "cachebuster", "nonce", "t", "ts", "timestamp", "_t"]);

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
