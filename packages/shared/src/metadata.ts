/**
 * Metadados obrigatórios de execução (PA-12, RN-EXE-001, RN-EXE-002).
 *
 * Sem estes campos o veredito é inválido: `runId` deve permitir reconstituir a
 * execução inteira.
 *
 * NOTA DE FASE 0 — alguns campos são tipados como `| null` porque os
 * componentes que os produzem ainda não existem (World Model e IR chegam nas
 * Fases 2 e 1). Declarar `null` é diferente de omitir: o relatório mostra
 * explicitamente que a dimensão não existia naquela execução, em vez de
 * inventar um valor. Quando o componente entrar, o campo perde o `| null` e a
 * mudança quebra a compilação de propósito.
 */
export interface RunMetadata {
  readonly runId: string;
  /** Fase 2. */
  readonly worldModelVersion: string | null;
  /** Fase 1. */
  readonly irVersion: string | null;
  readonly runnerVersion: string;
  /** `null` quando a execução não envolveu browser (ex.: diff de capturas prontas). */
  readonly browserVersion: string | null;
  readonly seed: string;
  readonly commit: string | null;
  readonly baseRef: string | null;
  readonly environment: string;
  /** RN-EXE-007 — aparece em todo relatório. */
  readonly confidenceMode: ConfidenceMode;
  /**
   * §15.2 — como o dado desta execução foi isolado. `template-clone` (RN-DAT-013:
   * banco clonado por execução e descartado) é o único que dá `ISOLATED` de
   * verdade no data plane; `shared-degraded` é o padrão honesto de quem aponta
   * para um banco vivo. `null` quando a execução não tocou banco.
   */
  readonly dataStrategy: DataStrategy | null;
  /** RN-AUT — Fase 0 opera sempre em L1. */
  readonly autonomyLevel: AutonomyLevel;
  /** UTC, sempre. Conversão só na camada de apresentação. */
  readonly startedAtUtc: string;
}

export type ConfidenceMode = "ISOLATED" | "PARTITIONED" | "SHARED_DEGRADED";

export type DataStrategy =
  "template-clone" | "ephemeral-container" | "partition" | "shared-degraded";

export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Relógio injetável. O núcleo determinístico (diff-engine) nunca lê o relógio:
 * quem precisa de tempo recebe um `Clock`. Isso mantém PA-12 verificável —
 * dois runs do mesmo par de capturas produzem o mesmo conjunto de deltas.
 */
export interface Clock {
  nowUtcIso(): string;
}

export const systemClock: Clock = {
  nowUtcIso: () => new Date().toISOString(),
};
