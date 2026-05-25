/**
 * Programmatic tenant (landlord org) creation via the api-gateway.
 *
 * Used by `02-tenant-create.spec.ts` and by `globalSetup` when the suite
 * needs a clean slate. Goes through the api-gateway — does NOT poke the
 * database directly — so RLS policies, audit-event emission, and the
 * regional defaulting (`tenants.region`) all fire for real.
 *
 * Endpoint candidates reflect the api-gateway's historical mount paths;
 * `tryPaths` walks them and uses the first non-404.
 *
 * Returns an object with the stable IDs the rest of the suite reads. We
 * keep the IDs in-memory (via `liveTestState`) rather than writing them
 * to disk so the spec is hermetic — re-running locally creates a fresh
 * tenant with a fresh suffix so we never collide with a previous run.
 */
import { tryPaths, type AuthedRequest } from './tenant-context';

// ============================================================================
// IN-MEMORY STATE — shared across the 10 sequential specs
// ============================================================================

export interface LiveTestState {
  tenantId: string;
  ownerUserId: string;
  propertyId: string;
  unitIds: string[];
  invitedTenantUserId: string;
  leaseId: string;
  paymentExternalId: string;
  maintenanceTicketId: string;
  decisionTraceId: string;
}

const stateHolder: { current: Partial<LiveTestState> } = { current: {} };

export function setLiveTestState(patch: Partial<LiveTestState>): void {
  stateHolder.current = { ...stateHolder.current, ...patch };
}

export function getLiveTestState(): Readonly<Partial<LiveTestState>> {
  return stateHolder.current;
}

export function requireState<K extends keyof LiveTestState>(
  key: K,
): LiveTestState[K] {
  const value = stateHolder.current[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(
      `live-test state missing required key "${String(key)}". A previous spec must run first.`,
    );
  }
  return value as LiveTestState[K];
}

// ============================================================================
// SEED HELPERS
// ============================================================================

export interface SeededTenant {
  tenantId: string;
  name: string;
  slug: string;
}

/** Create a landlord tenant org via the api-gateway. */
export async function seedTenant(
  authed: AuthedRequest,
  opts: { name: string; slug: string } = makeUniqueTenantInput(),
): Promise<SeededTenant> {
  const { status, body, path } = await tryPaths(
    authed,
    'POST',
    [
      '/api/v1/tenants',
      '/api/tenants',
      '/api/v1/orgs',
    ],
    {
      name: opts.name,
      slug: opts.slug,
      // The api-gateway defaults region from the caller's locale claim if
      // not provided — see W1 tenants.region wiring + EE region hardcodes.
      // We pass null here to exercise that default-resolution path.
      region: null,
    },
  );
  if (status >= 400) {
    throw new Error(
      `seedTenant failed: ${status} via ${path} :: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const parsed = body as {
    data?: { id?: string; tenantId?: string };
    id?: string;
    tenantId?: string;
  };
  const tenantId =
    parsed?.data?.id ??
    parsed?.data?.tenantId ??
    parsed?.id ??
    parsed?.tenantId ??
    '';
  if (!tenantId) {
    throw new Error(
      `seedTenant created but returned no id: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  setLiveTestState({ tenantId });
  return { tenantId, name: opts.name, slug: opts.slug };
}

export function makeUniqueTenantInput(): { name: string; slug: string } {
  const suffix = Date.now().toString(36);
  return {
    name: `Live-Test Properties ${suffix}`,
    slug: `live-test-properties-${suffix}`,
  };
}
