/**
 * Especificação de capability — §14.3 da arquitetura, RN-DAT-001..008.
 *
 * O banco é a sexta fonte de oráculo (O6) e o único ponto onde uma plataforma
 * autônoma toca estado persistente. Por isso o acesso é INDIRETO por
 * construção: ninguém — humano em runtime, muito menos modelo — emite SQL. Emite
 * uma capability: SQL parametrizado, escrito e aprovado em Git, com allowlist de
 * tabelas e colunas, sensibilidade por coluna, limite de linhas e timeout. O
 * executor recebe o NOME e os PARÂMETROS; a conexão nunca sai dele (PA-04).
 *
 * Nesta fatia (E-02, Fase 1) só existe `READ`, e é deliberado: `WRITE` e
 * `DESTRUCTIVE` exigem ambiente descartável (RN-DAT-007) e compensação — E-07 e
 * Fase 4. O tipo já os nomeia para que o validador os RECUSE explicitamente,
 * em vez de não saber o que são.
 */

export const CAPABILITY_SPEC_VERSION = 1;

export type CapabilityOperation = "READ" | "WRITE" | "DESTRUCTIVE";
export type CapabilityEngine = "sqlite" | "postgresql";
export type ParameterType = "string" | "integer" | "number" | "boolean" | "uuid";
export type Sensitivity = "LOW" | "PII" | "FINANCIAL" | "SECRET";
export type ApprovalStatus = "PROPOSED" | "APPROVED" | "REJECTED";
export type Environment = "ephemeral" | "isolated" | "staging" | "production";

export interface CapabilitySpec {
  readonly id: string;
  readonly version: number;
  /** `<domínio>.<verbo>`: `order.getDiscount`. É o que a jornada referencia. */
  readonly name: string;
  readonly description: string;
  readonly operation: CapabilityOperation;
  readonly engine: CapabilityEngine;
  readonly allowedEnvironments: readonly Environment[];
  /** Um único statement, parametrizado com `:nome`. Nunca concatenado. */
  readonly sql: string;
  readonly parameters: Readonly<
    Record<string, { readonly type: ParameterType; readonly required: boolean }>
  >;
  readonly allowlist: {
    readonly tables: readonly string[];
    /** `tabela.coluna`. */
    readonly columns: readonly string[];
  };
  /** Por `tabela.coluna`. Ausente = LOW. PII e SECRET são mascaradas na borda (RN-DAT-008). */
  readonly sensitivity: Readonly<Record<string, Sensitivity>>;
  readonly constraints: {
    readonly timeoutMs: number;
    readonly maxRows: number;
  };
  /**
   * Colunas que identificam a linha para o alinhamento no diff (§12.4:
   * "não por índice — por identidade"). Sem elas, o diff alinha por posição
   * e diz que alinhou por posição.
   */
  readonly keyColumns: readonly string[];
  /** Colunas que mudam a cada execução (`created_at`, sequences) e não entram no diff. */
  readonly volatileColumns: readonly string[];
  readonly approval: {
    readonly status: ApprovalStatus;
    readonly approvedBy: string | null;
    readonly approvedAt: string | null;
    readonly reviewPr: string | null;
  };
}

/** Limite compulsório de linhas quando a capability não declara (RN-DAT-004). */
export const DEFAULT_MAX_ROWS = 1000;
export const DEFAULT_TIMEOUT_MS = 3000;

export type ParameterValue = string | number | boolean;
