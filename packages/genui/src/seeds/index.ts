/**
 * Persona seed layouts — first-login templates for each TRC role.
 *
 * Five seeds, one per persona role declared in
 * `packages/database/src/seeds/trc-test-org-seed.ts`. On first login,
 * the portal-layout resolver clones the persona seed into the user's
 * `PortalLayout` document. The user (or AI agent in chat) then edits
 * the document; subsequent logins fetch the persisted doc, not the
 * seed.
 *
 * Seeds are JSON so they round-trip cleanly into the database, are
 * easy for non-engineers to review, and stay diffable in PRs. The
 * Zod schema (`PortalLayoutSeedSchema`) is the source of truth — every
 * file in this directory is `safeParse`d at import time so a malformed
 * seed cannot ship.
 *
 * Cites `.audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md`
 * §3 (persona-to-UI mapping for the 5 BOSS portals) and §5 Tier-1
 * task #2 ("5 persona seed layouts in `packages/genui/src/seeds/`").
 */

import {
  PortalLayoutSeedSchema,
  type PortalLayoutSeed,
  type PortalPersona,
  PORTAL_PERSONAS,
} from '../document';

import internalAdminSeedJson from './internal_admin.json';
import propertyManagerSeedJson from './property_manager.json';
import estateManagerSeedJson from './estate_manager.json';
import ownerSeedJson from './owner.json';
import customerSeedJson from './customer.json';

/**
 * Validate-and-freeze. Throws at module init if a seed is malformed —
 * the dev/CI will see it immediately rather than at first user login.
 */
function readSeed(raw: unknown, label: string): PortalLayoutSeed {
  const result = PortalLayoutSeedSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `[@borjie/genui] persona seed ${label} failed schema validation: ` +
        JSON.stringify(result.error.format()),
    );
  }
  return Object.freeze(result.data) as PortalLayoutSeed;
}

export const PORTAL_LAYOUT_SEEDS: Readonly<
  Record<PortalPersona, PortalLayoutSeed>
> = Object.freeze({
  internal_admin: readSeed(internalAdminSeedJson, 'internal_admin'),
  property_manager: readSeed(propertyManagerSeedJson, 'property_manager'),
  estate_manager: readSeed(estateManagerSeedJson, 'estate_manager'),
  owner: readSeed(ownerSeedJson, 'owner'),
  customer: readSeed(customerSeedJson, 'customer'),
});

/**
 * Lookup helper — returns `undefined` for unknown personas rather
 * than throwing so caller can fall back to the platform default.
 */
export function getPortalLayoutSeed(
  personaId: PortalPersona,
): PortalLayoutSeed | undefined {
  return PORTAL_LAYOUT_SEEDS[personaId];
}

/**
 * Platform default — used when persona resolution fails (e.g. a new
 * persona ID lands before its seed ships). Mirrors the customer
 * shape because it's the safest minimal surface.
 */
export const PORTAL_LAYOUT_DEFAULT_SEED: PortalLayoutSeed =
  PORTAL_LAYOUT_SEEDS.customer;

/** Re-export the persona list for callers that need the enum at runtime. */
export { PORTAL_PERSONAS };
