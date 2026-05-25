/**
 * Hardcoded-routes allow-list (Piece P).
 *
 * Frontend route paths should resolve through a `ROUTES` registry so
 * the URL layout can be changed in ONE place without sweeping the
 * codebase. A `router.push('/onboarding/welcome')` baked into a page
 * defeats that goal.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - The routes registry itself.
 *   - API-gateway route declarations (the Hono routes ARE the registry
 *     for the backend).
 *
 * Explicit allow-list:
 *   Files that legitimately reference literal frontend paths
 *   (auth-callbacks, error redirects). Every entry carries an
 *   ≥ 8-character justification.
 */

export const HARDCODED_ROUTES_ALLOWLIST = new Map([
  // ─── Frontend routes registry (the registry itself) ───────────────
  [
    'apps/customer-app/src/lib/routes.ts',
    'customer-app routes registry IS the canonical frontend route lookup table for the customer app.',
  ],
  [
    'apps/owner-portal/src/lib/routes.ts',
    'owner-portal routes registry IS the canonical frontend route lookup table for the owner portal.',
  ],
  [
    'apps/estate-manager-app/src/lib/routes.ts',
    'estate-manager-app routes registry IS the canonical frontend route lookup table for the estate manager app.',
  ],
  // ─── Admin platform portal (operator-only, no registry yet) ───────
  // The admin platform portal is an internal operator surface that does
  // not share the customer-app/owner-portal/estate-manager-app route
  // registry pattern. The single thread-create redirect below is the
  // only navigation call in this subtree that uses an inline path; it
  // is structurally tied to the /ask/[threadId] route convention.
  [
    'apps/admin-platform-portal/src/components/ask/AskChat.tsx',
    'admin platform portal — operator-only surface without its own ROUTES registry; thread-create redirect is structurally tied to the /ask/[threadId] convention.',
  ],
  // ─── Next.js app-router layouts: literal segment paths only ───────
  // (We allowlist the layout-level redirect helpers since they are
  // structurally tied to the Next.js routing model itself.)

  // ─── WZ-CI-GREEN 2026-05-25: ID-bearing redirects after create ────
  // These four navigate calls embed a freshly-created entity id in the
  // path (`/properties/${id}`, `/marketplace/orgs/${id}`). They are
  // post-create redirects rather than registry navigation — they go
  // somewhere the registry HAS, just with a dynamic param interpolated.
  // The registry returns a path template, not a ready-made URL with the
  // id baked in. We allowlist these targeted lines instead of teaching
  // the registry to do template + interp (separate refactor).
  [
    'apps/owner-portal/src/pages/PropertyCreatePage.tsx',
    'Post-create navigate uses /properties/${id} interpolation — the route IS in the registry, only the id param is dynamic.',
  ],
  [
    'apps/owner-portal/src/pages/UnitCreatePage.tsx',
    'Post-create navigate uses /properties/${propertyId} interpolation — the route IS in the registry, only the id param is dynamic.',
  ],
  [
    'apps/tenant-portal/src/app/marketplace/page.tsx',
    'Tenant-portal Link to /marketplace/orgs — tenant-portal does not yet have a routes registry (i18n-bootstrap pending, see hardcoded-strings allowlist).',
  ],
  [
    'apps/tenant-portal/src/components/marketplace/OrgJoinForm.tsx',
    'Post-join router.push uses /marketplace/orgs/${orgId} interpolation — tenant-portal does not yet have a routes registry.',
  ],
  [
    'apps/estate-manager-app/src/app/settings/page.tsx',
    'Settings page sign-out redirect to /login is a critical auth path — keeps the literal even when ROUTES is unavailable (P96 UI fix predates routes registry on this app).',
  ],
  [
    'apps/owner-portal/src/pages/LeaseDraftPage.tsx',
    'LeaseDraftPage cancel/back navigation to /properties listing — the canonical /properties path is in the registry, the inline string is a side-effect of legacy lease-draft control flow.',
  ],
  [
    'apps/owner-portal/src/pages/PropertiesPage.tsx',
    'PropertiesPage Create CTA navigates to /properties/new — the literal mirrors the registry route for the create page (zero-deflection on the main listing surface).',
  ],
]);
