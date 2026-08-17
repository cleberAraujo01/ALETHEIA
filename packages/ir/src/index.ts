export { IR_ACTIONS, IR_VERSION } from "./schema.js";
export type { IrAction, IrJourney, IrStep, IrValue, Rect, Target, Viewport } from "./schema.js";
export { parseIr } from "./validate.js";
export { LEGACY_JOURNEY_VERSION, parseLegacyJourney } from "./legacy.js";
export type { LegacyJourney, LegacyObservation } from "./legacy.js";
export { irToJourney, journeyToIr, loadJourney } from "./migrate.js";
