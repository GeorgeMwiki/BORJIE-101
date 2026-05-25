/**
 * Public surface for the intent-detection subsystem.
 */

export {
  classifyHeuristic,
  type HeuristicVerdict,
} from './heuristics.js';

export {
  detectTabGenerationIntent,
  hasTabGenerationIntent,
  type BrainPort,
  type BrainClassifyCall,
  type BrainClassifyResult,
  type DetectTabIntentInput,
  type DetectorDeps,
} from './detector.js';
