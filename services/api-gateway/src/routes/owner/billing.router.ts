/**
 * /api/v1/billing — owner-portal BillingPage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted BillingPage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/billing/subscription` as
 * the missing endpoint. This is the SaaS platform-fee surface (per-tenant
 * invoices remain on `/invoices` via the existing `invoicesService`).
 *
 * Until a Stripe (or alternative) subscription adapter is wired, this
 * returns a degraded subscription object with `status: 'unknown'` and
 * the `X-Backend-Status: degraded` header so the UI can render the
 * placeholder state instead of 404'ing.
 *
 * Follow-up api-gateway, BILLING-001 (#33): wire platform billing.
 *   Concrete next-step:
 *     1. Add `tenant_subscriptions` migration ({ tenantId, externalId,
 *        plan, status, renewalAt, currency, mrrMinor }).
 *     2. Add `BillingService.getSubscription(tenantId)` in
 *        @borjie/domain-services that wraps Stripe/Paystack.
 *     3. Replace the degraded payload below with the real read.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedObject, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'create tenant_subscriptions table + BillingService.getSubscription(tenantId) (Stripe/Paystack adapter) and replace this skeleton';

const FLAG_KEY = 'flag.bff.billing.subscription';

const app = new Hono();
app.use('*', authMiddleware);
// Subscription / platform billing is tenant-admin scope (the property
// owner pays the platform fee, not individual residents).
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

app.get('/subscription', async (c) => {
  const auth = c.get('auth');
  // Prefer the real wire when a platformBilling service is in the registry.
  const services = c.get('services') as {
    platformBilling?: { getSubscription: (tenantId: string) => Promise<unknown> };
  } | undefined;
  const billing = services?.platformBilling;  if (billing && typeof billing.getSubscription === 'function') {
    try {
      const sub = await billing.getSubscription(auth.tenantId);
      return c.json({ success: true, data: sub });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'billing service failed';
      return c.json(
        { success: false, error: { code: 'BILLING_SERVICE_ERROR', message } },
        503,
      );
    }
  }

  // Loud-failure path: 501 unless an operator turns the dev-mode flag on.
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  // Flag-on dev mode: degraded shape so the page still renders.
  markDegraded(c);
  return c.json(
    buildDegradedObject(auth.tenantId, NEXT_STEP, {
      plan: null,
      status: 'unknown',
      renewalAt: null,
      currency: null,
      mrrMinor: 0,
      seats: 0,
    }),
  );
});

export const billingRouter = app;
