/**
 * /api/v1/buyers — barrel for buyer-lifecycle routes (self-signup).
 *
 * Mounts the self-signup router (POST /api/v1/buyers/signup). Future
 * buyer-lifecycle endpoints join this barrel without touching the
 * top-level `services/api-gateway/src/index.ts`.
 *
 * KYC atom uploads (POST /api/v1/mining/buyers/kyc/atoms/:type) remain
 * mounted under `/mining` — they predate this surface and the wizard
 * imports them directly from `apps/buyer-mobile/src/buyer-signup/api.ts`.
 *
 * The DI surface lets the composition root inject the real Supabase
 * admin / Drizzle writer / persona binder / audit chain; tests inject
 * stubs.
 */

import { Hono } from 'hono';
import {
  createBuyerSignupRouter,
  type BuyerSignupDeps,
} from './signup.hono';

export {
  createBuyerSignupRouter,
  newBuyerTenantIdDefault,
  newBuyerOrgIdDefault,
  BuyerSignupRequestSchema,
  type BuyerSignupDeps,
  type BuyerSignupRequest,
  type BuyerSignupLogger,
  type SupabaseBuyerAdmin,
  type SupabaseBuyerUser,
  type SupabaseBuyerCreateResult,
  type BuyerWriter,
  type BuyerPersonaBinder,
  type BuyerAuditChainWriter,
  type CreatedBuyer,
} from './signup.hono';

/**
 * Build the composite /buyers router. Pass dependencies through to the
 * underlying signup router; future routers (verify, status, profile,
 * etc.) compose into the same Hono app under their own path prefix.
 */
export function createBuyersRouter(deps: BuyerSignupDeps): Hono {
  const app = new Hono();
  app.route('/', createBuyerSignupRouter(deps));
  return app;
}
