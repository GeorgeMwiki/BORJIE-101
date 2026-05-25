/**
 * MAP — builds the arrears-state graph (mild → moderate → serious →
 * critical → resolved-or-escalated).
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapArrears(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'leaseId' });
}
