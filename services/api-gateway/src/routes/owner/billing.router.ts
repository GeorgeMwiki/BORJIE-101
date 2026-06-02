/**
 * /api/v1/billing — owner-portal BillingPage (platform SaaS revenue).
 *
 * WS-4: now serves the REAL subscription state from the `PlatformBillingService`
 * (composition/billing), backed by `tenant_subscriptions` (migration 0178).
 * This is the platform-fee surface (per-tenant operational invoices remain on
 * `/invoices`).
 *
 * MONEY PATH (CLAUDE.md): `POST /subscription` charges the platform fee through
 * the provider PORT (IPaymentProvider) and posts the receivable through
 * LedgerService.post() — never a parallel ledger. The provider charge + the
 * ledger post share one idempotency key, so a retried subscribe never
 * double-charges or double-posts.
 *
 * When the platform-billing service is not wired (no payment provider
 * configured, or DATABASE_URL unset) the slot is absent and these routes
 * return a typed 503 — the page renders a clear "billing not configured"
 * state instead of fabricating data.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';

interface PlatformBillingPort {
  getSubscription(tenantId: string): Promise<unknown>;
  subscribe(input: {
    readonly tenantId: string;
    readonly plan: string;
    readonly mrrMinor: number;
    readonly seats: number;
    readonly billingPeriod: string;
    readonly providerCustomerId: string;
    readonly actorId: string;
  }): Promise<unknown>;
}

const SubscribeSchema = z.object({
  plan: z.string().trim().min(1).max(80),
  mrrMinor: z.number().int().positive(),
  seats: z.number().int().min(0).max(100_000).default(1),
  // 'yyyy-mm' billing period anchor (idempotency + renewal).
  billingPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'billingPeriod must be yyyy-mm'),
  providerCustomerId: z.string().trim().min(1).max(255),
});

const app = new Hono();
app.use('*', authMiddleware);
// Subscription / platform billing is tenant-admin scope (the owner pays the
// platform fee, not individual residents).
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

function resolveBilling(c: unknown): PlatformBillingPort | null {
  const services = (c as { get: (k: string) => unknown }).get('services') as
    | { platformBilling?: PlatformBillingPort | null }
    | undefined;
  const billing = services?.platformBilling;
  return billing && typeof billing.getSubscription === 'function' ? billing : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/subscription', async (c: any) => {
  const auth = c.get('auth');
  const billing = resolveBilling(c);
  if (!billing) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'BILLING_NOT_CONFIGURED',
          message:
            'Platform billing is not configured (no payment provider). Configure STRIPE_SECRET_KEY to enable subscriptions.',
        },
      },
      503,
    );
  }
  try {
    const sub = await billing.getSubscription(auth.tenantId);
    return c.json({ success: true as const, data: sub }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'billing service failed';
    return c.json(
      { success: false as const, error: { code: 'BILLING_SERVICE_ERROR', message } },
      503,
    );
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/subscription', async (c: any) => {
  const auth = c.get('auth');
  const billing = resolveBilling(c);
  if (!billing) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'BILLING_NOT_CONFIGURED',
          message:
            'Platform billing is not configured (no payment provider). Configure STRIPE_SECRET_KEY to enable subscriptions.',
        },
      },
      503,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
      },
      400,
    );
  }
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid subscription request' },
      },
      400,
    );
  }

  try {
    const result = await billing.subscribe({
      tenantId: auth.tenantId,
      plan: parsed.data.plan,
      mrrMinor: parsed.data.mrrMinor,
      seats: parsed.data.seats,
      billingPeriod: parsed.data.billingPeriod,
      providerCustomerId: parsed.data.providerCustomerId,
      actorId: auth.userId ?? 'unknown',
    });
    return c.json({ success: true as const, data: result }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'subscribe failed';
    return c.json(
      { success: false as const, error: { code: 'BILLING_SERVICE_ERROR', message } },
      503,
    );
  }
});

export const billingRouter = app;
