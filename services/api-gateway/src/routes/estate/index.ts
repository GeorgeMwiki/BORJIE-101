/**
 * Estate routes — Wave ESTATE-OS barrel.
 *
 * Mounted under /api/v1/estate/* in services/api-gateway/src/index.ts.
 */

export {
  createEstateGroupsRouter,
  estateGroupsRouter,
} from './groups.hono';
export {
  createEstateEntitiesRouter,
  estateEntitiesRouter,
} from './entities.hono';
export {
  createEstateCapitalMovementsRouter,
  estateCapitalMovementsRouter,
} from './capital-movements.hono';
// NOTE: `succession.hono.ts` was a pre-launch duplicate of
// `succession-plans.hono.ts` (same path, same endpoints). The mounted
// router is `estateSuccessionPlansRouter` from `succession-plans.hono.ts`;
// the audit-trail behaviour that lived in the duplicate has been ported
// there. See `Docs/AUDIT/UNWIRED_LOGIC_REGISTRY.md`.
export {
  createEstateAssetsRouter,
  estateAssetsRouter,
} from './assets.hono';
