/**
 * Insurance sub-router — mounts at /api/v1/insurance.
 *
 * Composes quote + policy surfaces (migration 0106). The broker port
 * abstraction lives in services/api-gateway/src/services/insurance-broker.
 */

import { Hono } from 'hono';
import { quotesRouter } from './quotes.hono';
import { policiesRouter } from './policies.hono';

const app = new Hono();
app.route('/', quotesRouter);
app.route('/', policiesRouter);

export const insuranceRouter = app;
