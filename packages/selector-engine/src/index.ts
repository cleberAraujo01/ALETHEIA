export {
  DEFAULT_WEIGHTS,
  GENERATED_ID_WEIGHT,
  SIGNAL_ORDER,
  isGeneratedId,
  weightedSignalsOf,
} from "./fingerprint.js";
export type { Signal, WeightedSignal } from "./fingerprint.js";
export { DEFAULT_CONSENSUS, decide } from "./consensus.js";
export type { Candidate, Consensus, ConsensusOptions, SignalMatches } from "./consensus.js";
export { proposeHeal } from "./heal.js";
export type { HealRecord } from "./heal.js";
export { ELEMENT_REPOSITORY_VERSION, findElement, parseElementRepository } from "./repository.js";
export type { ElementEntry, ElementRepository } from "./repository.js";
