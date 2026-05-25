/**
 * Public surface for live-coaching. The headline is `coach({...})` —
 * heuristics always run, brain-generated hints append if a brain is
 * supplied.
 */
export { coach, type CoachArgs } from './coach.js';
export {
  heuristicCoach,
  type HeuristicCoachArgs,
} from './heuristics.js';
export {
  createThrottledCoach,
  type ThrottleOptions,
  type ThrottledCoach,
} from './throttle.js';
