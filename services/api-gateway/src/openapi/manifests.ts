/**
 * Route manifests — centralised OpenAPI metadata declarations for the
 * gateway's routers.
 *
 * Most routers today are written with `@hono/zod-validator` which does
 * not expose Zod schemas at runtime. Rather than refactor all 40+ to
 * the `OpenAPIHono`/`createRoute` style (invasive, behaviour-risk),
 * we declare their schemas here once. The harvester cross-references
 * by `{prefix, method, path}` against Hono's runtime `.routes` table.
 *
 * Adding a new route:
 *   1. Wire the Hono handler as usual (with `zValidator` if desired).
 *   2. Add a `registerRoute({ ... })` entry below.
 *   3. That's it — the spec picks it up at the next `/openapi.json`
 *      request.
 *
 * Endpoints that are NOT listed here still appear in the spec with a
 * minimal path item (method, path, default responses) because the
 * harvester emits everything it finds.
 */

import { z } from 'zod';
import { registerRoute } from './schema-registry';

// ----------------------------------------------------------------------------
// Shared schemas — defined once so the generated spec deduplicates.
// ----------------------------------------------------------------------------

const SuccessEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
  });

const IdParam = z.object({ id: z.string().min(1) });

// ----------------------------------------------------------------------------
// auth (prefix: /auth)
// ----------------------------------------------------------------------------

registerRoute({
  prefix: '/auth',
  method: 'post',
  path: '/login',
  summary: 'Authenticate with email + password',
  tags: ['auth'],
  auth: 'none',
  rateLimit: 'auth-login',
  requestBody: z.object({
    email: z.string().email().max(255),
    password: z.string().min(1).max(200),
  }),
  responses: {
    200: {
      description: 'Authentication succeeded — bearer JWT returned.',
      schema: SuccessEnvelope(
        z.object({
          token: z.string(),
          user: z.object({
            id: z.string(),
            email: z.string().email(),
            firstName: z.string().nullable().optional(),
            lastName: z.string().nullable().optional(),
            avatarUrl: z.string().nullable().optional(),
          }),
          tenant: z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
          }),
          role: z.string(),
          permissions: z.array(z.string()),
          properties: z.array(z.string()),
          expiresAt: z.string().datetime(),
        })
      ),
    },
    401: { description: 'Invalid credentials.' },
    403: { description: 'Account or tenant not active.' },
    503: { description: 'Authentication not configured (no database).' },
  },
});

registerRoute({
  prefix: '/auth',
  method: 'get',
  path: '/me',
  summary: 'Get the currently-authenticated user + tenant',
  tags: ['auth'],
  responses: {
    200: { description: 'Current user payload returned.' },
  },
});

registerRoute({
  prefix: '/auth',
  method: 'post',
  path: '/refresh',
  summary: 'Rotate the bearer token',
  description:
    'The old token is added to the revocation blocklist; a new token with a fresh jti is returned.',
  tags: ['auth'],
  responses: {
    200: {
      description: 'New bearer token.',
      schema: SuccessEnvelope(z.object({ token: z.string(), expiresAt: z.string().datetime() })),
    },
  },
});

registerRoute({
  prefix: '/auth',
  method: 'post',
  path: '/logout',
  summary: 'Revoke the current bearer token',
  tags: ['auth'],
  responses: {
    200: { description: 'Token revoked.' },
  },
});

// ----------------------------------------------------------------------------
// applications (prefix: /applications — NEW 18 station-master routing)
// ----------------------------------------------------------------------------

registerRoute({
  prefix: '/applications',
  method: 'get',
  path: '/',
  summary: 'Smoke test — returns empty applications list',
  tags: ['applications'],
  responses: { 200: { description: 'Empty list.' } },
});

registerRoute({
  prefix: '/applications',
  method: 'post',
  path: '/route',
  summary: 'Resolve the station master for an application',
  tags: ['applications'],
  permissions: ['applications:route'],
  requestBody: z.object({
    applicationId: z.string().min(1),
    assetType: z.enum(['residential', 'commercial', 'land', 'mixed_use']),
    location: z.object({
      city: z.string().optional(),
      country: z.string().optional(),
      regionId: z.string().optional(),
      propertyId: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }),
  }),
  responses: {
    200: { description: 'Routing result.' },
    404: { description: 'No match.' },
    503: { description: 'Router service not configured.' },
  },
});

// ----------------------------------------------------------------------------
// waitlist (prefix: /waitlist)
// ----------------------------------------------------------------------------

registerRoute({
  prefix: '/waitlist',
  method: 'post',
  path: '/units/:unitId/join',
  summary: 'Customer joins the waitlist for a unit',
  tags: ['waitlist'],
  requestParams: z.object({ unitId: z.string().min(1) }),
  requestBody: z.object({
    customerId: z.string().min(1),
    listingId: z.string().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    source: z
      .enum(['enquiry', 'failed_application', 'manual_add', 'marketplace_save', 'ai_recommended'])
      .optional(),
    preferredChannels: z.array(z.enum(['sms', 'whatsapp', 'email', 'push', 'in_app'])).max(4).optional(),
    notificationPreferenceId: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  }),
  responses: {
    201: { description: 'Joined waitlist.' },
    400: { description: 'Validation or business-rule failure.' },
  },
});

registerRoute({
  prefix: '/waitlist',
  method: 'post',
  path: '/:id/leave',
  summary: 'Customer leaves the waitlist',
  tags: ['waitlist'],
  requestParams: IdParam,
  requestBody: z.object({ reason: z.string().max(1000).optional() }),
  responses: {
    200: { description: 'Left waitlist.' },
    404: { description: 'Waitlist entry not found.' },
    409: { description: 'Already closed.' },
  },
});

registerRoute({
  prefix: '/waitlist',
  method: 'get',
  path: '/units/:unitId',
  summary: 'List waitlist for a unit (owner view)',
  tags: ['waitlist'],
  requestParams: z.object({ unitId: z.string().min(1) }),
  responses: { 200: { description: 'Active waitlist entries.' } },
});

registerRoute({
  prefix: '/waitlist',
  method: 'get',
  path: '/customers/:customerId',
  summary: 'List waitlists a customer has joined',
  tags: ['waitlist'],
  requestParams: z.object({ customerId: z.string().min(1) }),
  responses: { 200: { description: 'Customer waitlist entries.' } },
});

registerRoute({
  prefix: '/waitlist',
  method: 'post',
  path: '/units/:unitId/trigger-outreach',
  summary: 'Manually trigger vacancy outreach for a unit',
  tags: ['waitlist'],
  requestParams: z.object({ unitId: z.string().min(1) }),
  responses: { 200: { description: 'Outreach dispatched.' } },
});

// ----------------------------------------------------------------------------
// notification-preferences (prefix: /me/notification-preferences)
// ----------------------------------------------------------------------------

const NotificationPrefsSchema = z.object({
  channels: z.record(z.any()).optional(),
  templates: z.record(z.any()).optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
});

registerRoute({
  prefix: '/me/notification-preferences',
  method: 'get',
  path: '/',
  summary: 'Get current user notification preferences',
  tags: ['notifications'],
  responses: {
    200: {
      description: 'Preferences returned.',
      schema: SuccessEnvelope(NotificationPrefsSchema),
    },
  },
});

registerRoute({
  prefix: '/me/notification-preferences',
  method: 'put',
  path: '/',
  summary: 'Upsert current user notification preferences',
  tags: ['notifications'],
  requestBody: NotificationPrefsSchema,
  responses: {
    200: {
      description: 'Updated preferences returned.',
      schema: SuccessEnvelope(NotificationPrefsSchema),
    },
    400: { description: 'Validation error.' },
  },
});
