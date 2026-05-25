/**
 * MAP — builds the complaint taxonomy + escalation-tree distribution.
 * Each event carries `state` (received|classified|routed|acknowledged|
 * resolved|escalated) and `caseId` (the complaint id).
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapComplaints(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'caseId' });
}
