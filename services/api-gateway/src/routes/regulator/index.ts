/**
 * Regulator routes — barrel.
 *
 * Mounts under `/api/v1/regulator`. Issue #194 chains C-A
 * (data-subject requests). Future chains plug in more sub-routers.
 */

export { createRegulatorRequestsRouter } from './requests.hono';
