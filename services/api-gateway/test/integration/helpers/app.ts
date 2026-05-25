/**
 * Gateway app loader.
 *
 * We import the compiled gateway lazily (and only once) AFTER test-env
 * has pinned `DATABASE_URL` and `JWT_SECRET`. The gateway's module
 * graph memoises a Drizzle client at import time — loading it too
 * early would either pin the production URL or capture `null`.
 *
 * Exposes:
 *   getApp()   — singleton Express app (with Hono mounted at /api/v1)
 *   baseUrl()  — the /api/v1 prefix, kept here so tests don't
 *                hard-code strings.
 */

import type { Express } from 'express';

let cached: Express | null = null;

export async function getApp(): Promise<Express> {
  if (cached) return cached;
  // Dynamic import ensures test-env.ts has already executed.
  const mod = await import('../../../src/index');
  const app = (mod.default ?? (mod as unknown as Express)) as Express;
  cached = app;
  return app;
}

export const API_BASE = '/api/v1';
