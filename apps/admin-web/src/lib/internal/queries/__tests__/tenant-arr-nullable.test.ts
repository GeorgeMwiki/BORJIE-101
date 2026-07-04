/**
 * GATE (A6): fabricated "TZS 0" ARR across the tenant directory + tabs.
 *
 * The tenants list route (services/api-gateway/.../tenants.hono.ts) has no
 * ARR / mrr / revenue column, so the adapter's `raw.arr` is virtually always
 * absent. The old `adaptTenant` carried `arr: 0` for the absent case — which
 * every consumer rendered as `<currency> 0`, an INVENTED revenue figure shown
 * as owner truth for every tenant.
 *
 * This gate asserts the honest contract: an ARR-less raw row maps to
 * `arr: null` (→ a localized "—" at the render sites), while a real numeric
 * ARR still passes through. It BITES: reverting the adapter to `: 0` flips the
 * first assertion RED.
 */
import { describe, expect, it } from 'vitest';
import { adaptTenant } from '@/lib/internal/queries/tenants';

describe('adaptTenant ARR nullability (A6)', () => {
  it('maps an ARR-less row to null, never a fabricated 0', () => {
    const t = adaptTenant({ id: 'tenant_1', name: 'Kahama Gold' });
    expect(t.arr).toBeNull();
    // The consumers key their honest-dash render off `=== null`; a 0 here
    // would slip through as `<currency> 0`.
    expect(t.arr).not.toBe(0);
  });

  it('passes a real numeric ARR through unchanged', () => {
    const t = adaptTenant({ id: 'tenant_2', name: 'Geita Co', arr: 4200000 });
    expect(t.arr).toBe(4200000);
  });

  it('treats a non-finite ARR as absent (null, not NaN or 0)', () => {
    const t = adaptTenant({
      id: 'tenant_3',
      name: 'Mwadui Ltd',
      arr: Number.NaN,
    });
    expect(t.arr).toBeNull();
  });
});
