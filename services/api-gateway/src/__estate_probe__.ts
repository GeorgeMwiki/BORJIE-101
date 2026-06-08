import {
  situationalModel as situationalModelKernel,
  motivation as motivationKernel,
  estateMind as estateMindKernel,
} from '@borjie/central-intelligence';

type A = typeof situationalModelKernel.SituationalModelStore;
type B = typeof motivationKernel.DriveThresholds;
type C = typeof estateMindKernel.ProposalSink;
const sm = situationalModelKernel.createSituationalModel;
const me = motivationKernel.createMotivationEngine;
const em = estateMindKernel.createEstateMind;
console.log(typeof sm, typeof me, typeof em);
