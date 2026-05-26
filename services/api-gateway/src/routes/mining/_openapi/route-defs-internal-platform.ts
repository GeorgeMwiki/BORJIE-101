/**
 * `createRoute` definitions for /internal/compliance-queue and
 * /internal/tenants. Corpus / prompts / audit-log defs live in
 * `./route-defs-internal-corpus.ts` to keep each module under 300 lines.
 */
import { createRoute, z } from '@hono/zod-openapi';

import { successEnvelope, errorResponses, jsonContent } from './envelopes';
import { InternalIdParamSchema } from './internal-schemas';
import {
  ComplianceEscalationSchema,
  ComplianceQueueQuerySchema,
  TenantRowSchema,
  ProvisionTenantSchema,
  PatchTenantSchema,
} from './internal-platform-schemas';

const security = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// compliance-queue
// ---------------------------------------------------------------------------

const complianceTags = ['internal-compliance-queue'];

export const internalComplianceListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: complianceTags,
  summary: 'List compliance escalations awaiting platform-staff triage.',
  security,
  request: { query: ComplianceQueueQuerySchema },
  responses: {
    200: jsonContent(
      successEnvelope(z.array(ComplianceEscalationSchema)),
      'Escalation rows (default: open only).',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalComplianceApproveRoute = createRoute({
  method: 'post',
  path: '/{id}/approve',
  tags: complianceTags,
  summary: 'Resolve an escalation as approved.',
  security,
  request: { params: InternalIdParamSchema },
  responses: {
    200: jsonContent(
      successEnvelope(ComplianceEscalationSchema),
      'Resolved escalation row.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const internalComplianceRejectRoute = createRoute({
  method: 'post',
  path: '/{id}/reject',
  tags: complianceTags,
  summary: 'Resolve an escalation as rejected.',
  security,
  request: { params: InternalIdParamSchema },
  responses: {
    200: jsonContent(
      successEnvelope(ComplianceEscalationSchema),
      'Resolved escalation row.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

// ---------------------------------------------------------------------------
// tenants
// ---------------------------------------------------------------------------

const tenantsTags = ['internal-tenants'];

export const internalTenantsListRoute = createRoute({
  method: 'get',
  path: '/',
  tags: tenantsTags,
  summary: 'List provisioned tenants.',
  security,
  responses: {
    200: jsonContent(
      successEnvelope(z.array(TenantRowSchema)),
      'Tenant rows ordered by creation desc.',
    ),
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalTenantsProvisionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: tenantsTags,
  summary: 'Provision a new tenant.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ProvisionTenantSchema } },
    },
  },
  responses: {
    201: jsonContent(successEnvelope(TenantRowSchema), 'Newly provisioned tenant.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export const internalTenantsUpdateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: tenantsTags,
  summary: 'Update tenant plan / billing.',
  security,
  request: {
    params: InternalIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: PatchTenantSchema } },
    },
  },
  responses: {
    200: jsonContent(successEnvelope(TenantRowSchema), 'Updated tenant.'),
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export const internalTenantsSuspendRoute = createRoute({
  method: 'post',
  path: '/{id}/suspend',
  tags: tenantsTags,
  summary: 'Suspend a tenant.',
  security,
  request: { params: InternalIdParamSchema },
  responses: {
    200: jsonContent(successEnvelope(TenantRowSchema), 'Suspended tenant.'),
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

