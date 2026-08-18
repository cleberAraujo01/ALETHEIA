export {
  PlatformError,
  QualityVerdict,
  isPlatformError,
  isQualityVerdict,
  exitCodeFor,
  EXIT_CODE,
} from "./errors.js";
export type { ErrorContext, ExitCode, PlatformErrorCode, QualityVerdictCode } from "./errors.js";

export { systemClock } from "./metadata.js";
export type {
  AutonomyLevel,
  Clock,
  ConfidenceMode,
  DataStrategy,
  RunMetadata,
} from "./metadata.js";

export { createLogger } from "./logger.js";
export type { LogContext, LogFields, LogLevel, Logger, LoggerOptions } from "./logger.js";

export { canonicalize, newRunId, stableHash } from "./hash.js";
