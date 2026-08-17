import type { ParameterValue } from "../spec.js";

/**
 * Adaptador de engine — o ÚNICO lugar do repositório onde existe conexão com
 * banco (CLAUDE.md §3.2, arch-check PA-04: driver só em `capabilities/src/executor/`).
 *
 * A interface é deliberadamente pobre: recebe SQL JÁ VALIDADO e parâmetros JÁ
 * TIPADOS, devolve linhas. Não sabe o que é capability, não sabe o que é
 * mascaramento, não decide nada. Quem decide é o executor, uma camada acima, e
 * ele nunca expõe o adaptador para fora.
 */
export interface EngineAdapter {
  readonly engine: "sqlite" | "postgresql";
  query(
    sql: string,
    parameters: Readonly<Record<string, ParameterValue>>,
    timeoutMs: number,
  ): Promise<QueryRows>;
  close(): Promise<void>;
}

export interface QueryRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
}
