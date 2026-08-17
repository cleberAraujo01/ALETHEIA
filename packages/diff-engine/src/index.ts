export { runDiff } from "./pipeline.js";
export type { DiffOptions } from "./pipeline.js";

export { parseCapture } from "./capture/validate.js";
export { CAPTURE_VERSION, SUPPORTED_CAPTURE_VERSIONS } from "./types/capture.js";
export type {
  Capture,
  CaptureTarget,
  ConsoleEntry,
  DomNode,
  JsonValue,
  NetworkExchange,
  Observation,
  Rect,
  ScreenshotRef,
} from "./types/capture.js";

export type { RasterImage, RasterSet } from "./types/raster.js";
export { DEFAULT_VISUAL_OPTIONS, compareRasters } from "./visual/compare.js";
export type { VisualComparison, VisualComparisonOptions, VisualRegion } from "./visual/compare.js";

export type {
  Classification,
  Delta,
  DeltaKind,
  DeltaLayer,
  OracleSource,
  Severity,
} from "./types/delta.js";

export { REPORT_VERSION } from "./types/report.js";
export type {
  CaptureSummary,
  CoverageReport,
  DeltaSummary,
  DiffReport,
  LayerGap,
  NormalizationSummary,
  SuppressionSummary,
  Verdict,
} from "./types/report.js";

export { DEFAULT_CALIBRATION } from "./score/calibration.js";
export type { Calibration } from "./score/calibration.js";

export { DEFAULT_DELTA_BUDGET_PER_OBSERVATION } from "./diff/types.js";

export { SUPPRESSION_CATALOG } from "./suppress/catalog.js";
export { MIN_EVIDENCE, validateSuppressionRules } from "./suppress/rule.js";
export type { EvidenceRef, SuppressionRule } from "./suppress/rule.js";
export {
  SUPPRESSION_SET_VERSION,
  compileLearnedRules,
  emptySuppressionSet,
  matchesSignature,
  parseSuppressionSet,
  pathSkeleton,
  signatureOf,
  validateSuppressionSet,
} from "./suppress/learned.js";
export type {
  DeltaSignature,
  LearnedSuppressionRule,
  SuppressionSet,
  SuppressionSetIssue,
  SuppressionStatus,
} from "./suppress/learned.js";
export { proposeSuppressions, simulateSuppression } from "./suppress/learn.js";
export { groupDeltas, groupIdOf } from "./group/index.js";
export type { DeltaGroup } from "./group/index.js";
export type {
  ProposalInput,
  ProposalOutcome,
  RuleSimulation,
  SignatureConflict,
  SuppressionSimulation,
} from "./suppress/learn.js";

export { NORMALIZATION_RULES } from "./normalize/volatile.js";

export {
  assessGrouping,
  measure,
  scaffoldLabels,
  PHASE_0_MAX_FALSE_POSITIVE_RATE,
  PHASE_0_REQUIRED_DEFECTS,
} from "./measure/index.js";
export type {
  ConfusionMatrix,
  DefectCoverage,
  GroupingAssessment,
  ExitCriteriaCheck,
  HumanLabel,
  LabelEntry,
  LabelSet,
  Measurement,
} from "./measure/index.js";
