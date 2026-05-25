/**
 * MAP — vendor onboarding state graph (kyc → classified → msa-drafted
 * → msa-signed → payment-rail-added → active).
 */

import { runMapStage } from '../shared/map-stage.js';
import type { ObservedEvent, ProcessGraph } from '../shared/sub-md-base.js';

export function mapVendor(events: ReadonlyArray<ObservedEvent>): ProcessGraph {
  return runMapStage({ events, stateKey: 'state', caseKey: 'vendorId' });
}
