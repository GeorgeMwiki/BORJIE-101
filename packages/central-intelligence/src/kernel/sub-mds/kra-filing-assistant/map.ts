/**
 * MAP — KRA filing process graph keyed by ownerId+period.
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapKraFiling(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'filingId' });
}
