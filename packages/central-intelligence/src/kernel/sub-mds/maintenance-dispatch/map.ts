/**
 * MAP — builds the vendor-performance graph + SLA-breach
 * distribution.
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapMaintenance(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  // Maintenance events carry `state` (received|classified|dispatched|
  // acknowledged|on-site|resolved|no-show) and `caseId` (the ticket
  // id). The shared map primitive does the rest.
  return runMapStage({ events, stateKey: 'state', caseKey: 'caseId' });
}
