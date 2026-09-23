/**
 * Deltas — a saída do Diff Engine.
 *
 * Um delta é uma **hipótese de regressão**, não um veredito (§2.4.1). A
 * classificação é atribuída pelo estágio determinístico de classificação; o
 * LLM não participa em momento algum desta fase (PA-01).
 */

export type DeltaLayer = "DOM" | "NETWORK" | "VISUAL" | "CONSOLE" | "DATABASE";

export type DeltaKind =
  // Nível de observação
  | "OBSERVATION_ADDED"
  | "OBSERVATION_REMOVED"
  // DOM
  | "DOM_NODE_ADDED"
  | "DOM_NODE_REMOVED"
  | "DOM_TEXT_CHANGED"
  | "DOM_ATTRIBUTE_CHANGED"
  | "DOM_ATTRIBUTE_ADDED"
  | "DOM_ATTRIBUTE_REMOVED"
  | "DOM_ROLE_CHANGED"
  | "DOM_ACCESSIBLE_NAME_CHANGED"
  | "DOM_CHILDREN_REORDERED"
  // Relação metamórfica declarada (O3), verificada sobre o DOM
  | "RELATION_VIOLATED"
  | "RELATION_UNEVALUABLE"
  // Rede
  | "REQUEST_ADDED"
  | "REQUEST_REMOVED"
  | "REQUEST_COUNT_CHANGED"
  | "STATUS_CHANGED"
  | "RESPONSE_FIELD_ADDED"
  | "RESPONSE_FIELD_REMOVED"
  | "RESPONSE_FIELD_CHANGED"
  | "RESPONSE_TYPE_CHANGED"
  // Visual
  | "VISUAL_REGION_CHANGED"
  | "VISUAL_DIMENSIONS_CHANGED"
  // Console
  | "CONSOLE_MESSAGE_ADDED"
  | "CONSOLE_MESSAGE_REMOVED"
  | "CONSOLE_COUNT_CHANGED"
  // Banco (O6)
  | "DB_ROW_ADDED"
  | "DB_ROW_REMOVED"
  | "DB_FIELD_CHANGED"
  | "DB_ROWCOUNT_CHANGED"
  | "DB_PROBE_FAILED"
  | "DB_PROBE_MISSING";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** RN-ORC-009 — toda classificação possível. `UNDETERMINED` nunca bloqueia. */
export type Classification = "REGRESSION" | "INTENDED_CHANGE" | "NOISE" | "UNDETERMINED";

export interface Delta {
  /**
   * Identidade determinística do delta: mesmo par de capturas ⇒ mesmo id.
   * Permite deduplicar entre execuções e rastrear um delta ao longo do tempo.
   */
  readonly deltaId: string;
  readonly layer: DeltaLayer;
  readonly kind: DeltaKind;
  readonly observationId: string;
  /**
   * Caminho semântico dentro da camada.
   * DOM: caminho de identidade (`body > main > [role=button "Finalizar"]`).
   * Rede: `GET /api/orders/:id#0` + JSON Pointer (`/data/total`).
   */
  readonly path: string;
  /**
   * Valores observados, já normalizados e truncados.
   *
   * ATENÇÃO PA-09: estes campos podem conter dado real do cliente. São
   * legítimos no relatório do próprio cliente e PROIBIDOS em qualquer contexto
   * enviado a um modelo. Quem for construir o Narrator (Fase 4) manda a forma,
   * nunca o valor.
   */
  readonly before: string | null;
  readonly after: string | null;
  readonly severity: Severity;
  /** Pontuação do estágio 5. Ver `score/calibration.ts` para as hipóteses. */
  readonly score: number;
  readonly classification: Classification;
  /** Id da regra de supressão que classificou como NOISE, quando houver. */
  readonly suppressedBy: string | null;
  /**
   * Grupo a que o delta pertence — mesma camada, tipo e esqueleto de caminho
   * (ver `group/`). Não altera severidade nem classificação; é chave de
   * triagem, e a mesma chave que a supressão aprendida usa.
   */
  readonly groupId: string;
  /** Fatos adicionais para triagem. Escalares apenas. */
  readonly facts: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Fonte de oráculo que fundamentou o veredito (RN-ORC-001).
 * Fase 0 opera exclusivamente sobre O5 — a versão anterior da aplicação.
 */
export type OracleSource = "O1" | "O2" | "O3" | "O4" | "O5" | "O6";
