/**
 * Supabase Auth integration — barrel export.
 *
 * Activated when `AUTH_PROVIDER=supabase`. Provides:
 *   - `supabaseAuthMiddleware` — drop-in replacement for the legacy
 *     JWT middleware. Same `AuthContext` shape.
 *   - `buildSupabaseAuthRoutes` — Hono sub-app to mount under
 *     `/auth/supabase/*` for sign-up / sign-in / magic-link / OTP /
 *     refresh / sign-out passthrough.
 *   - Session helpers for SSR cookie rotation.
 */

export {
  supabaseAuthMiddleware,
  selectAuthMiddleware,
  mapSupabaseRolesToUserRole,
} from './supabase-auth-middleware.js';

export { buildSupabaseAuthRoutes } from './supabase-auth-routes.js';

export {
  rotateSession,
  shouldRotate,
  buildSessionCookie,
  SupabaseSessionError,
  type SupabaseSessionResponse,
  type SessionRotationConfig,
  type SessionCookieOptions,
} from './supabase-session.js';

export {
  verifySupabaseJwt,
  extractBearer,
  SupabaseAuthError,
  type SupabaseAuthPrincipal,
  type VerifySupabaseJwtOptions,
} from './supabase-jwt-verify.js';
