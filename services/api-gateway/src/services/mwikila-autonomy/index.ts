/**
 * Mr. Mwikila autonomous-MD framework — service public surface.
 *
 * Usage:
 *
 *   import { mwikila } from '../services/mwikila-autonomy';
 *
 *   const recorder = mwikila.createMwikilaInboxRecorder({ db });
 *   const store    = mwikila.createMwikilaDelegationStore({ db });
 *   const runtime  = mwikila.createMwikilaHandlerRuntime({ recorder, delegations: store });
 *
 *   const shift = mwikila.createShiftSchedulerHandler({
 *     listActiveWorkforce: ...,
 *     listSiteCapacity:    ...,
 *     hasOverlappingSchedule: ...,
 *   });
 *
 *   await runtime.run({ tenantId, actingOnUserId: ownerUserId, handler: shift });
 */

export * from './types.js';
export {
  createMwikilaInboxRecorder,
  pickInitialStatus,
  type MwikilaInboxRecorder,
  type MwikilaInboxRecorderDeps,
} from './inbox-recorder.js';

export {
  createMwikilaDelegationStore,
  type MwikilaDelegationStore,
  type MwikilaDelegationStoreDeps,
} from './delegation-store.js';

export {
  createMwikilaHandlerRuntime,
  type MwikilaHandler,
  type MwikilaHandlerProposal,
  type MwikilaHandlerRuntime,
  type MwikilaHandlerRuntimeDeps,
} from './handler-runtime.js';

export * from './handlers/index.js';
