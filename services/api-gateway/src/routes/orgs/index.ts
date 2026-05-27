/**
 * /api/v1/orgs — barrel for org-lifecycle routes.
 *
 * Mounts the self-signup router (POST /api/v1/orgs/signup). Future
 * org-lifecycle endpoints (org-update, org-delete, kyc-submit) join
 * this barrel without touching `services/api-gateway/src/index.ts`.
 *
 * The DI surface lets the main composition root inject the real
 * Supabase admin / Drizzle writer / persona binder / audit chain;
 * tests inject stubs.
 */

import { Hono } from 'hono';
import {
  createSignupRouter,
  type SignupDeps,
} from './signup.hono';

export {
  createSignupRouter,
  newTenantIdDefault,
  newUserIdDefault,
  defaultSlugFactory,
  SignupRequestSchema,
  type SignupDeps,
  type SignupRequest,
  type SupabaseAdmin,
  type SupabaseAdminUser,
  type TenantWriter,
  type PersonaBinder,
  type AuditChainWriter,
  type SignupLogger,
  type CreatedTenant,
} from './signup.hono';

/**
 * Build the composite /orgs router. Pass dependencies through to the
 * underlying signup router; future routers compose into the same Hono
 * app under their own path prefix.
 */
export function createOrgsRouter(deps: SignupDeps): Hono {
  const app = new Hono();
  app.route('/', createSignupRouter(deps));
  return app;
}
