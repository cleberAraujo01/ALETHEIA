export { IR_ACTIONS, IR_VERSION } from "./schema.js";
export { isTargetRef } from "./schema.js";
export type {
  DatabaseProbe,
  IrAction,
  IrJourney,
  IrStep,
  IrValue,
  Rect,
  Target,
  TargetRef,
  TargetSpec,
  Viewport,
} from "./schema.js";
export { parseFingerprint, parseIr } from "./validate.js";
export { LEGACY_JOURNEY_VERSION, parseLegacyJourney } from "./legacy.js";
export type { LegacyJourney, LegacyObservation } from "./legacy.js";
export { irToJourney, journeyToIr, loadJourney } from "./migrate.js";
