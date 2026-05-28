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
export {
  createEstateSuccessionRouter,
  estateSuccessionRouter,
} from './succession.hono';
export {
  createEstateAssetsRouter,
  estateAssetsRouter,
} from './assets.hono';
