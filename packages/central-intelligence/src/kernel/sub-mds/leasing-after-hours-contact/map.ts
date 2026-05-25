/**
 * MAP — builds the inquiry → response graph and tracks reply-latency
 * SLA breaches.
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapLeasing(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'inquiryId' });
}
