// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union.
/**
 * Tenant Credit Rating Router.
 *
 *   GET  /tenants/:customerId                      — current rating (landlord-admin)
 *   GET  /tenants/:customerId/history?months=24    — trajectory (landlord-admin)
 *   POST /tenants/:customerId/recompute            — force recompute (landlord-admin)
 *   POST /tenants/:customerId/record-promise-outcome — mark honored/dishonored
 *   GET  /my-rating                                — self-service tenant rating
 *   POST /my-rating/opt-in-sharing                 — consent to cross-landlord share
 *   GET  /my-rating/certificate                    — signed portable certificate
 *   GET  /weights                                  — active weights for tenant
 *   PUT  /weights                                  — update weights (landlord-admin)
 *
 * Tenant isolation: every handler scopes by `auth.tenantId`. Cross-tenant
 * reads require an active opt-in in `credit_rating_sharing_opt_ins`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import {
  buildSignedCertificate,
  renderCertificateDocument,
  type CreditRatingService,
} from '@borjie/ai-copilot';
import { scrubMessage } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const RecordPromiseSchema = z.object({
  kind: z.enum(['extension', 'installment', 'lease_amendment']),
  agreedDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  actualOutcome: z.enum(['on_time', 'late', 'defaulted', 'pending']),
  notes: z.string().max(1000).nullable().optional(),
});

const WeightsSchema = z.object({
  payment_history: z.number().nonnegative(),
  promise_keeping: z.number().nonnegative(),
  rent_to_income: z.number().nonnegative(),
  tenancy_length: z.number().nonnegative(),
  dispute_history: z.number().nonnegative(),
});

const OptInShareSchema = z.object({
  shareWithOrg: z.string().min(1).max(200),
  purpose: z.string().min(1).max(200).default('tenancy_application'),
  durationDays: z.number().int().min(1).max(365).default(60),
});

function svc(c: any): CreditRatingService | null {
  const services = c.get('services') ?? {};
  return services.creditRating ?? c.get('creditRatingService') ?? null;
}

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'CREDIT_RATING_SERVICE_UNAVAILABLE',
        message: 'CreditRatingService not configured in gateway context.',
      },
    },
    503,
  );
}

function resolveCustomerIdForSelf(c: any): string | null {
  // Tenants' customer records map 1:1 from the JWT user id in our Kenya
  // SaaS model. We accept either an explicit `customerId` claim or the
  // fallback `userId` which the customer-app onboarding stamps to match.
  const auth = c.get('auth');
  return auth?.customerId ?? auth?.userId ?? null;
}

function mapError(c: any, err: unknown) {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : 'CREDIT_RATING_FAILED';
  const status = code === 'CUSTOMER_NOT_FOUND' ? 404 : 400;
  // Wave 19 Agent H+I: known domain errors carry a stable `code` and
  // their `message` is safe to expose. Unknown errors fall through to
  // the scrubber so raw driver strings cannot leak.
  const isDomainError =
    code !== 'CREDIT_RATING_FAILED' && err instanceof Error && !!err.message;
  const msg = isDomainError
    ? (err as Error).message
    : scrubMessage(err, 'Credit rating operation failed');
  return c.json({ success: false, error: { code, message: msg } }, status);
}

const app = new Hono();
app.use('*', authMiddleware);

// --- GET current rating (admin) ---------------------------------------------
app.get(
  '/tenants/:customerId',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('customerId');
    try {
      const rating = await s.computeRating(tenantId, customerId);
      return c.json({ success: true, data: rating });
    } catch (err) {
      return mapError(c, err);
    }
  },
);

// --- GET history (admin) ----------------------------------------------------
app.get(
  '/tenants/:customerId/history',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('customerId');
    const months = Number(c.req.query('months') ?? '24');
    try {
      const history = await s.getHistory(tenantId, customerId, months);
      return c.json({ success: true, data: history });
    } catch (err) {
      return mapError(c, err);
    }
  },
);

// --- POST recompute (admin) -------------------------------------------------
app.post(
  '/tenants/:customerId/recompute',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  withSecurityEvents({ action: 'credit-rating.create', resource: 'credit-rating', severity: 'info' }, async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('customerId');
    try {
      const rating = await s.computeRating(tenantId, customerId);
      return c.json({ success: true, data: rating }, 201);
    } catch (err) {
      return mapError(c, err);
    }
  }),
);

// --- POST record promise outcome (admin) ------------------------------------
app.post(
  '/tenants/:customerId/record-promise-outcome',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', RecordPromiseSchema),
  withSecurityEvents({ action: 'credit-rating.create', resource: 'credit-rating', severity: 'info' }, async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('customerId');
    const body = c.req.valid('json');
    try {
      const record = await s.recordPromiseOutcome(tenantId, customerId, body);
      return c.json({ success: true, data: record }, 201);
    } catch (err) {
      return mapError(c, err);
    }
  }),
);

// --- GET self-service rating ------------------------------------------------
app.get('/my-rating', async (c: any) => {
  const s = svc(c);
  if (!s) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const customerId = resolveCustomerIdForSelf(c);
  if (!customerId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CUSTOMER_NOT_RESOLVED',
          message:
            'No customer record linked to this login — contact your landlord to enable self-service credit.',
        },
      },
      400,
    );
  }
  try {
    const rating = await s.computeRating(tenantId, customerId);
    return c.json({ success: true, data: rating });
  } catch (err) {
    return mapError(c, err);
  }
});

// --- POST opt-in sharing ----------------------------------------------------
app.post(
  '/my-rating/opt-in-sharing',
  zValidator('json', OptInShareSchema),
  withSecurityEvents({ action: 'credit-rating.create', resource: 'credit-rating', severity: 'info' }, async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const customerId = resolveCustomerIdForSelf(c);
    if (!customerId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CUSTOMER_NOT_RESOLVED',
            message: 'No customer record linked to this login.',
          },
        },
        400,
      );
    }
    const body = c.req.valid('json');
    try {
      const record = await s.optInSharing({
        tenantId,
        customerId,
        shareWithOrg: body.shareWithOrg,
        purpose: body.purpose,
        durationDays: body.durationDays,
      });
      return c.json({ success: true, data: record }, 201);
    } catch (err) {
      return mapError(c, err);
    }
  }),
);

// --- GET portable certificate -----------------------------------------------
app.get('/my-rating/certificate', async (c: any) => {
  const s = svc(c);
  if (!s) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const customerId = resolveCustomerIdForSelf(c);
  if (!customerId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CUSTOMER_NOT_RESOLVED',
          message: 'No customer record linked to this login.',
        },
      },
      400,
    );
  }
  const secret =
    process.env.CREDIT_CERT_SECRET ??
    process.env.CREDIT_RATING_SIGNING_SECRET ??
    null;
  if (!secret || secret.length < 16) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CERT_SECRET_NOT_CONFIGURED',
          message:
            'CREDIT_CERT_SECRET environment variable missing or < 16 chars.',
        },
      },
      503,
    );
  }
  const verificationBase =
    process.env.PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'https://api.borjie.com';

  try {
    const rating = await s.computeRating(tenantId, customerId);
    const cert = buildSignedCertificate({
      rating,
      signingSecret: secret,
      verificationBaseUrl: verificationBase,
    });
    const doc = renderCertificateDocument(cert);
    return c.json({ success: true, data: doc });
  } catch (err) {
    return mapError(c, err);
  }
});

// --- GET weights ------------------------------------------------------------
app.get('/weights', async (c: any) => {
  const s = svc(c);
  if (!s) return notConfigured(c);
  const tenantId = c.get('tenantId');
  try {
    const weights = await s.getWeights(tenantId);
    return c.json({ success: true, data: weights });
  } catch (err) {
    return mapError(c, err);
  }
});

// --- PUT weights (admin) ----------------------------------------------------
app.put(
  '/weights',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', WeightsSchema),
  withSecurityEvents({ action: 'credit-rating.update', resource: 'credit-rating', severity: 'info' }, async (c: any) => {
    const s = svc(c);
    if (!s) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    try {
      const weights = await s.setWeights(tenantId, body);
      return c.json({ success: true, data: weights });
    } catch (err) {
      return mapError(c, err);
    }
  }),
);

export default app;
