/**
 * Cooperatives sub-router — mounts at /api/v1/cooperatives.
 *
 * Currently composes the settlement-period surface (migration 0105).
 * Future cooperative-domain endpoints (member registry, levies
 * config, contested-period dispute) will hang off this same router.
 */

import { Hono } from 'hono';
import { settlementsRouter } from './settlements.hono';

const app = new Hono();
app.route('/', settlementsRouter);

export const cooperativesRouter = app;
