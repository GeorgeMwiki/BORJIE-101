/**
 * Auth session shim. The real token storage lives in `src/api/session.ts`
 * (already wired through AsyncStorage). This module exists at the path the
 * api-gateway wiring contract requires (`src/auth/session.ts`) and simply
 * re-exports the cached/persisted accessors so call sites can `import` from
 * the auth domain rather than reaching into the api layer.
 */

export {
  getAuthToken,
  setAuthToken,
  getCachedAuthToken
} from '../api/session'
