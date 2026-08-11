import type { DeltaKind, DeltaLayer } from "../types/delta.js";

/**
 * Delta bruto — saída do estágio 3 (diferenciação), antes de supressão,
 * pontuação e classificação. Separar os estágios é o que permite medir o
 * impacto de cada regra isoladamente no corpus de referência (§6.4).
 */
export interface RawDelta {
  readonly layer: DeltaLayer;
  readonly kind: DeltaKind;
  readonly observationId: string;
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly facts: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Orçamento de deltas por observação.
 *
 * Uma página que mudou de layout inteiro pode gerar dezenas de milhares de
 * deltas, e um relatório com 40.000 linhas não é informação — é ruído com
 * outro nome. O corte é necessário, mas NUNCA silencioso: `truncated` vira
 * lacuna declarada de cobertura (RN-COB-001).
 */
export class DeltaBudget {
  #remaining: number;
  #truncated = false;

  constructor(limit: number) {
    this.#remaining = limit;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  get exhausted(): boolean {
    return this.#remaining <= 0;
  }

  /** @returns `false` quando o orçamento acabou e o delta não foi aceito. */
  take(): boolean {
    if (this.#remaining <= 0) {
      this.#truncated = true;
      return false;
    }
    this.#remaining -= 1;
    return true;
  }
}

/**
 * HIPÓTESE (a calibrar com corpus real): 500 deltas por observação é o ponto
 * em que um relatório deixa de ser acionável. O valor certo sai da medição de
 * quantos deltas um humano de fato triava por execução.
 */
export const DEFAULT_DELTA_BUDGET_PER_OBSERVATION = 500;

/** Valores no relatório são truncados para manter o artefato manuseável. */
export const MAX_VALUE_LENGTH = 240;

export function truncateValue(value: string | null): string | null {
  if (value === null) return null;
  if (value.length <= MAX_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_VALUE_LENGTH)}…<+${value.length - MAX_VALUE_LENGTH}>`;
}
