import type { NormalizationLedger } from "./ledger.js";
import {
  NORMALIZATION_RULES,
  stripContentHash,
  PLACEHOLDER,
  isIdentifierPathSegment,
  isIsoTimestamp,
  isUuid,
  isVolatileQueryParam,
} from "./volatile.js";

const SYNTHETIC_ORIGIN = "http://relative.invalid";

export interface UrlNormalizationOptions {
  /**
   * Origem da própria aplicação sob teste. Base e head vivem em hosts e portas
   * diferentes por construção (duas builds, dois ambientes) — sem remover a
   * origem própria, **toda** requisição apareceria como divergente e o motor
   * seria inútil. Chamadas a terceiros preservam o host, porque mudar de
   * provedor externo é exatamente o tipo de regressão que queremos ver.
   */
  readonly selfOrigin: string | null;
  /**
   * Para que esta URL está sendo normalizada — e a distinção não é cosmética.
   *
   *   `ALIGNMENT` (rede): a URL é a **chave** que emparelha a requisição da
   *   base com a do head. Aqui `/orders/1042` e `/orders/1043` precisam virar a
   *   mesma chave, senão viram "uma sumiu, outra apareceu" e o diff de corpo,
   *   que é onde mora o valor, nunca acontece.
   *
   *   `VALUE` (atributo de DOM): a URL é o **conteúdo** sendo comparado. O
   *   `href` de um botão não emparelha nada — o nó já foi emparelhado pela
   *   estrutura. Apagar o identificador aqui não compra alinhamento nenhum e
   *   custa detecção.
   *
   * MEDIDO, não suposto: com `VALUE` normalizado como chave, o corpus real
   * `juventude` perdeu inteiro o defeito do número de WhatsApp trocado
   * (`wa.me/5511941126936` → `…939`). O segmento numérico virava `:id` nos dois
   * lados e o motor não via absolutamente nada — falso negativo silencioso, que
   * é a pior falha possível deste produto.
   */
  readonly purpose?: "ALIGNMENT" | "VALUE";
}

/** Extrai a origem (`scheme://host:port`) de uma URL, ou `null` se inválida. */
export function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export function normalizeUrl(
  rawUrl: string,
  options: UrlNormalizationOptions,
  ledger: NormalizationLedger,
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, SYNTHETIC_ORIGIN);
  } catch {
    return rawUrl;
  }

  const forAlignment = (options.purpose ?? "ALIGNMENT") === "ALIGNMENT";

  const segments = parsed.pathname.split("/").map((segment) => {
    if (segment.length === 0) return segment;
    // Hash de conteúdo de bundle (`page-4f2a…8c.js`): é o MESMO módulo com
    // outro nome, porque o build mudou. Vale nos dois propósitos — o nome é
    // gerado, não escrito por ninguém, e comparar hash de build só produz
    // barulho proporcional ao tamanho do bundler.
    const withoutHash = stripContentHash(segment);
    if (withoutHash !== segment) {
      ledger.record(NORMALIZATION_RULES.NET_BUILD_CONTENT_HASH);
      return withoutHash;
    }
    if (forAlignment && isIdentifierPathSegment(segment)) {
      ledger.record(NORMALIZATION_RULES.NET_PATH_IDENTIFIER);
      return PLACEHOLDER.ID_SEGMENT;
    }
    return segment;
  });

  const params: Array<[string, string]> = [];
  let removedParam = false;
  for (const [name, value] of parsed.searchParams.entries()) {
    if (isVolatileQueryParam(name)) {
      removedParam = true;
      continue;
    }
    params.push([name, normalizeScalarValue(value, ledger)]);
  }
  if (removedParam) {
    ledger.record(NORMALIZATION_RULES.NET_VOLATILE_QUERY_PARAM);
  }

  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (params.some(([name], index) => sorted[index]?.[0] !== name)) {
    ledger.record(NORMALIZATION_RULES.NET_QUERY_PARAM_ORDER);
  }

  const query = sorted.map(([name, value]) => `${name}=${value}`).join("&");
  const origin =
    parsed.origin === SYNTHETIC_ORIGIN || parsed.origin === options.selfOrigin ? "" : parsed.origin;

  return `${origin}${segments.join("/")}${query.length > 0 ? `?${query}` : ""}${parsed.hash}`;
}

/**
 * Normaliza um valor escalar cuja volatilidade se reconhece pelo próprio valor.
 *
 * RISCO ACEITO E DECLARADO: um timestamp normalizado aqui é um timestamp que
 * deixamos de comparar. Se a aplicação exibir a data errada num campo cujo
 * valor é ISO-8601, não veremos. A alternativa — não normalizar — faz toda
 * execução divergir, porque base e head são executadas em instantes
 * diferentes. ARQUITETURA.md §12.4 lista timestamps como ruído a suprimir, e é
 * por isso que esta regra existe. É a PRIMEIRA candidata a medição no corpus
 * de referência: se a taxa de falso negativo por timestamp for relevante,
 * troca-se por normalização relativa (delta de tempo entre base e head).
 */
export function normalizeScalarValue(value: string, ledger: NormalizationLedger): string {
  if (isUuid(value)) {
    ledger.record(NORMALIZATION_RULES.NET_UUID_VALUE);
    return PLACEHOLDER.UUID;
  }
  if (isIsoTimestamp(value)) {
    ledger.record(NORMALIZATION_RULES.NET_TIMESTAMP_VALUE);
    return PLACEHOLDER.TIMESTAMP;
  }
  return value;
}
