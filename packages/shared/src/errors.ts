/**
 * Erros canônicos da plataforma.
 *
 * A distinção entre `PlatformError` e `QualityVerdict` é a regra RN-CI-005 e é
 * o bug mais danoso possível quando confundida: uma falha de infraestrutura
 * NOSSA nunca pode bloquear o Pull Request do cliente. Se o gate bloquear por
 * um problema que não é do código do cliente, o time perde a confiança no
 * produto e desativa o gate — e o produto morre.
 *
 * Regra prática:
 *   - Algo nosso quebrou, ou não conseguimos observar        → PlatformError
 *   - Observamos com sucesso e o resultado é ruim            → QualityVerdict
 */

/** Contexto estruturado de erro. Nunca aceita payload bruto, segredo ou PII. */
export type ErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export type PlatformErrorCode =
  /** Não foi possível ler o artefato de captura informado. */
  | "CAPTURE_UNREADABLE"
  /** Captura lida, mas o conteúdo não satisfaz o schema. */
  | "CAPTURE_INVALID"
  /** Versão de captura não suportada por esta versão do runner. */
  | "CAPTURE_VERSION_UNSUPPORTED"
  /** Base e head não são comparáveis (targets sem interseção de rotas). */
  | "CAPTURES_NOT_COMPARABLE"
  /** Falha ao escrever o relatório no destino. */
  | "REPORT_WRITE_FAILED"
  /** Conjunto de regras de supressão aprendidas ilegível ou fora do contrato. */
  | "SUPPRESSION_SET_INVALID"
  /** Jornada (IR) fora do schema: passo, alvo ou valor mal formados. */
  | "IR_INVALID"
  /** Versão de IR que este runner não interpreta nem migra. */
  | "IR_VERSION_UNSUPPORTED"
  /** Um passo da jornada não pôde ser executado: alvo não encontrado, ambíguo, ação recusada pela página. */
  | "STEP_FAILED"
  /** Convergência não atingida dentro do deadline (RN-EXE-006). */
  | "TIMEOUT_CONVERGENCE"
  /** Invariante interna do nosso próprio código foi violada. Sempre bug nosso. */
  | "INTERNAL_INVARIANT_BROKEN";

export type QualityVerdictCode =
  /** Ao menos um delta classificado como REGRESSION. Bloqueia. */
  | "REGRESSION_DETECTED"
  /** Nenhuma regressão. Não bloqueia. */
  | "NO_REGRESSION_DETECTED"
  /**
   * Só há deltas UNDETERMINED. Nunca bloqueia (RN-ORC-009), mas é reportado
   * de forma visível: silenciar isto seria falso negativo (PA-10).
   */
  | "UNDETERMINED_ONLY";

abstract class AletheiaError extends Error {
  abstract readonly kind: "PLATFORM_ERROR" | "QUALITY_VERDICT";
  readonly context: ErrorContext;

  protected constructor(message: string, context: ErrorContext) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }
}

/**
 * Falha da plataforma. NUNCA bloqueia o PR do cliente (RN-CI-005).
 * O shim de CI deve reportar como neutro/aviso, jamais como reprovação.
 */
export class PlatformError extends AletheiaError {
  readonly kind = "PLATFORM_ERROR" as const;
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, context: ErrorContext = {}, cause?: unknown) {
    super(`[${code}] falha de plataforma`, context);
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Veredito de qualidade sobre a aplicação do cliente. Pode bloquear.
 * `blocking` é derivado do código — não é decidido por quem lança.
 */
export class QualityVerdict extends AletheiaError {
  readonly kind = "QUALITY_VERDICT" as const;
  readonly code: QualityVerdictCode;

  constructor(code: QualityVerdictCode, context: ErrorContext = {}) {
    super(`[${code}] veredito de qualidade`, context);
    this.code = code;
  }

  get blocking(): boolean {
    return this.code === "REGRESSION_DETECTED";
  }
}

export function isPlatformError(value: unknown): value is PlatformError {
  return value instanceof PlatformError;
}

export function isQualityVerdict(value: unknown): value is QualityVerdict {
  return value instanceof QualityVerdict;
}

/**
 * Códigos de saída do processo. O contrato com os shims de CI depende disto,
 * então os valores são estáveis e documentados.
 *
 *   0 — execução concluída, nenhuma regressão
 *   1 — execução concluída, veredito bloqueante (falha REAL do cliente)
 *   2 — falha da plataforma; o shim NÃO deve reprovar o PR (RN-CI-005)
 */
export const EXIT_CODE = {
  OK: 0,
  QUALITY_GATE_FAILED: 1,
  PLATFORM_FAILURE: 2,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export function exitCodeFor(outcome: PlatformError | QualityVerdict): ExitCode {
  if (isPlatformError(outcome)) {
    return EXIT_CODE.PLATFORM_FAILURE;
  }
  return outcome.blocking ? EXIT_CODE.QUALITY_GATE_FAILED : EXIT_CODE.OK;
}
