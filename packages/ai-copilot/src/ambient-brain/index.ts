/**
 * Ambient Brain \u2014 the always-on Mr. Mwikila layer.
 *
 * Three cooperating pieces:
 *   1. AIPresenceManager    \u2014 tracks where the user is and what Mr. Mwikila
 *                              should whisper in their ear.
 *   2. BehaviorObserver     \u2014 zero-LLM statistical observer that detects
 *                              stalls, errors, and milestones.
 *   3. ProactiveInterventionEngine \u2014 decides whether/how to surface the
 *                              resulting intervention to the UI.
 */

export * from './types.js';
export { getPageContext } from './page-context-registry.js';
export {
  AIPresenceManager,
  type ContextualHelp,
} from './ai-presence-manager.js';
export {
  BehaviorObserver,
  createBehaviorSignalSource,
  DEFAULT_BEHAVIOR_SIGNAL_CONFIG,
  type BehaviorAnalytics,
  type BehaviorSignal,
  type BehaviorSignalConfig,
  type BehaviorSignalKind,
  type BehaviorSignalSource,
  type SensoriumEventLogSource,
} from './behavior-observer.js';
export {
  ProactiveInterventionEngine,
  DEFAULT_PREFERENCES,
  type InterventionPreferences,
  type DeliveredIntervention,
} from './proactive-intervention.js';
