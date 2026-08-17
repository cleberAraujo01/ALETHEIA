import type { Target } from "@aletheia/ir";
import { PlatformError } from "@aletheia/shared";

/**
 * Repositório de elementos — §12.3: fingerprints deduplicados por aplicação,
 * "Page Object Model gerado automaticamente". Nesta fatia ele é lido: a IR
 * referencia `{ "ref": "el_btn_entrar" }` e o runner resolve pelo fingerprint
 * daqui. Correção num lugar propaga para toda jornada que usa o ref.
 *
 * `stability` é o histórico que a §12.2 chama de `stabilityHistory`. Quem o
 * atualiza é quem tem o trace da execução — a CLI, depois do run —, nunca o
 * runner no meio da captura (a captura não escreve no repositório do projeto).
 */

export const ELEMENT_REPOSITORY_VERSION = "0.1.0";

export interface ElementEntry {
  /** `el_<slug>`. */
  readonly id: string;
  readonly description: string;
  readonly fingerprint: Target;
  readonly stability: {
    readonly resolvedRuns: number;
    readonly healedRuns: number;
    readonly lastHealAtUtc: string | null;
  };
}

export interface ElementRepository {
  readonly version: string;
  readonly projectId: string;
  readonly elements: readonly ElementEntry[];
}

const ELEMENT_ID = /^el_[A-Za-z0-9_-]+$/;

export function parseElementRepository(raw: unknown, source: string): ElementRepository {
  const fail = (path: string, reason: string): never => {
    throw new PlatformError("IR_INVALID", { source, path, reason });
  };
  if (!isRecord(raw)) return fail("$", "objeto esperado");
  if (raw["version"] !== ELEMENT_REPOSITORY_VERSION) {
    throw new PlatformError("IR_VERSION_UNSUPPORTED", {
      source,
      found: String(raw["version"]),
      supported: ELEMENT_REPOSITORY_VERSION,
    });
  }
  const projectId = raw["projectId"];
  if (typeof projectId !== "string" || projectId.length === 0)
    return fail("$.projectId", "obrigatório");
  if (!Array.isArray(raw["elements"])) return fail("$.elements", "lista esperada");
  const seen = new Set<string>();
  const elements = (raw["elements"] as unknown[]).map((entry, index): ElementEntry => {
    const where = `$.elements[${index}]`;
    if (!isRecord(entry)) return fail(where, "objeto esperado");
    const id = entry["id"];
    if (typeof id !== "string" || !ELEMENT_ID.test(id))
      return fail(`${where}.id`, "esperado `el_<slug>`");
    if (seen.has(id)) return fail(`${where}.id`, `duplicado: ${id}`);
    seen.add(id);
    if (!isRecord(entry["fingerprint"])) return fail(`${where}.fingerprint`, "objeto esperado");
    const stabilityRaw = isRecord(entry["stability"]) ? entry["stability"] : {};
    return {
      id,
      description: typeof entry["description"] === "string" ? entry["description"] : "",
      // A forma do fingerprint é a do `Target` da IR; a validação de sinais é
      // do validador da IR (mesmas regras, mesmo lugar). Aqui só se lê.
      fingerprint: entry["fingerprint"],
      stability: {
        resolvedRuns: numberOr(stabilityRaw["resolvedRuns"]),
        healedRuns: numberOr(stabilityRaw["healedRuns"]),
        lastHealAtUtc:
          typeof stabilityRaw["lastHealAtUtc"] === "string" ? stabilityRaw["lastHealAtUtc"] : null,
      },
    };
  });
  return { version: ELEMENT_REPOSITORY_VERSION, projectId, elements };
}

export function findElement(repository: ElementRepository, id: string): ElementEntry | null {
  return repository.elements.find((entry) => entry.id === id) ?? null;
}

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
