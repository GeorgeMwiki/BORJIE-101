/**
 * Production sub-router — mounts at /api/v1/production.
 *
 * Currently composes the tonnage capture surface (migration 0104).
 * Additional production-domain endpoints (recovery yield, plant
 * throughput, stockpile balance) will hang off this same router so
 * the api-gateway composition root only sees one entry.
 */

import { Hono } from 'hono';
import { tonnageRouter } from './tonnage.hono';

const app = new Hono();
app.route('/', tonnageRouter);

export const productionRouter = app;
