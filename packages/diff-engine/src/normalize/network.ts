import { stableHash } from "@aletheia/shared";

import type { JsonValue, NetworkExchange } from "../types/capture.js";

import type { NormalizationLedger } from "./ledger.js";
import { normalizeScalarValue, normalizeUrl, type UrlNormalizationOptions } from "./url.js";
import { NORMALIZATION_RULES, PLACEHOLDER, isVolatileJsonKey } from "./volatile.js";

/**
 * Profundidade máxima de descida em corpo JSON. Estruturas mais profundas são
 * truncadas com marcador explícito — nunca silenciosamente.
 *
 * HIPÓTESE (a calibrar): 24 níveis cobrem payloads reais com folga. Se o
 * corpus mostrar truncamento frequente, o número sobe. O marcador no relatório
 * é o que permite descobrir isso.
 */
export const MAX_JSON_DEPTH = 24;

export const TRUNCATED = "<truncated:depth>";

export interface NormalizedExchange {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly resourceType: string;
  readonly requestBody: JsonValue | null;
  readonly responseBody: JsonValue | null;
  /** `GET /api/orders/:id` — chave de alinhamento do estágio 2. */
  readonly identityKey: string;
  readonly durationMs: number | null;
}

export function normalizeExchange(
  exchange: NetworkExchange,
  urlOptions: UrlNormalizationOptions,
  ledger: NormalizationLedger,
): NormalizedExchange {
  const method = exchange.method.toUpperCase();
  const url = normalizeUrl(exchange.url, urlOptions, ledger);

  return {
    method,
    url,
    status: exchange.status,
    resourceType: exchange.resourceType,
    requestBody: normalizeJson(exchange.requestBody, ledger, 0),
    responseBody: normalizeJson(exchange.responseBody, ledger, 0),
    identityKey: stableHash({ method, url }),
    durationMs: exchange.durationMs,
  };
}

export function normalizeJson(
  value: JsonValue | null,
  ledger: NormalizationLedger,
  depth: number,
): JsonValue | null {
  if (value === null) return null;
  if (depth >= MAX_JSON_DEPTH) return TRUNCATED;

  if (typeof value === "string") {
    return normalizeScalarValue(value, ledger);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    // A ordem de arrays é preservada. Declarar um array como "não ordenado"
    // exige evidência da aplicação (§6.4) e vira regra de supressão, não
    // normalização estrutural.
    return value.map((entry) => normalizeJson(entry, ledger, depth + 1) ?? null);
  }

  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (isVolatileJsonKey(key)) {
      ledger.record(NORMALIZATION_RULES.NET_VOLATILE_JSON_KEY);
      result[key] = PLACEHOLDER.VOLATILE;
      continue;
    }
    result[key] = normalizeJson(entry, ledger, depth + 1) ?? null;
  }
  return result;
}
