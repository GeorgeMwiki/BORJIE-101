/**
 * MAP — lease lifecycle process graph keyed by leaseId.
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapLease(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'leaseId' });
}
