import type { QualityVerdictCode, RunMetadata } from "@aletheia/shared";

import type { Classification, Delta, DeltaLayer, OracleSource, Severity } from "./delta.js";

export const REPORT_VERSION = "0.1.0";

export interface DiffReport {
  readonly reportVersion: string;
  /** PA-12 — sem isto o veredito é inválido. */
  readonly metadata: RunMetadata;
  /** RN-ORC-001 — todo veredito declara qual oráculo o fundamentou. */
  readonly oracle: OracleSource;
  readonly oracleDescription: string;
  readonly base: CaptureSummary;
  readonly head: CaptureSummary;
  readonly verdict: Verdict;
  readonly summary: DeltaSummary;
  readonly deltas: readonly Delta[];
  readonly normalization: NormalizationSummary;
  readonly suppression: SuppressionSummary;
  /** RN-COB-001 — o que NÃO foi validado. */
  readonly coverage: CoverageReport;
}

export interface CaptureSummary {
  readonly captureId: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly commit: string | null;
  readonly capturedAtUtc: string;
  readonly observationCount: number;
}

export interface Verdict {
  readonly code: QualityVerdictCode;
  /** Só `REGRESSION_DETECTED` bloqueia. `UNDETERMINED` nunca (RN-ORC-009). */
  readonly blocking: boolean;
  readonly rationale: string;
}

export interface DeltaSummary {
  readonly total: number;
  readonly byClassification: Readonly<Record<Classification, number>>;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  readonly byLayer: Readonly<Record<DeltaLayer, number>>;
}

export interface NormalizationSummary {
  readonly total: number;
  readonly byRule: Readonly<Record<string, number>>;
}

export interface SuppressionSummary {
  readonly catalogSize: number;
  readonly deltasSuppressed: number;
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Declaração de cobertura. Existe porque um relatório que só mostra o que foi
 * verificado induz a conclusão errada de que o resto está certo (PA-10).
 */
export interface CoverageReport {
  readonly observationsCompared: number;
  readonly observationsOnlyInBase: readonly string[];
  readonly observationsOnlyInHead: readonly string[];
  /** Observações cujo diff foi cortado por orçamento — resultado incompleto. */
  readonly observationsTruncated: readonly string[];
  readonly layersNotValidated: readonly LayerGap[];
  readonly notes: readonly string[];
}

export interface LayerGap {
  readonly layer: string;
  readonly reason: string;
  /** Observações afetadas; vazio quando a lacuna é global. */
  readonly observations: readonly string[];
}
