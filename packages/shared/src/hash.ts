import { createHash, randomUUID } from "node:crypto";

/**
 * Hash estável e determinístico. Usado para fingerprint de subárvore de DOM,
 * identidade de exchange de rede e chave de deduplicação de delta.
 *
 * Determinismo é requisito de PA-12: o mesmo par de capturas precisa produzir
 * exatamente os mesmos identificadores em qualquer máquina.
 */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 16);
}

/**
 * Serialização canônica: chaves de objeto em ordem lexicográfica, para que
 * `{a:1,b:2}` e `{b:2,a:1}` produzam o mesmo hash. Arrays preservam ordem —
 * ordem de array é significativa até que uma regra de normalização declare o
 * contrário para um caminho específico.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "undefined";
}

/** `runId` é único e imutável (RN-EXE-001). */
export function newRunId(): string {
  return `run_${randomUUID()}`;
}
