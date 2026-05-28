/**
 * Admin persona — T2 admin-strategist tools (Borjie internal staff).
 *
 * Six tools surfacing platform-wide read-only views needed by the
 * admin-web console. `admin.kill-switch.status` is the only HIGH-risk
 * descriptor here — it reports the switch but never flips it, and is
 * flagged `requiresPolicyRuleLiteral` so any reason-resolver that tries
 * to generalise it gets refused upstream (CLAUDE.md hard rule).
 *
 * None of these are WRITE tools; the admin console flips switches
 * through dedicated sovereign-ledger routes that live elsewhere.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const ADMIN: ReadonlyArray<'T2_admin_strategist'> = ['T2_admin_strategist'];

// 1. Recent tenants
const TenantsListInput = z.object({
  limit: z.number().int().positive().max(50).default(20),
});
const TenantsListOutput = z.object({
  tenants: z.array(
    z.object({
      tenantId: z.string(),
      displayName: z.string(),
      createdAt: z.string(),
      status: z.enum(['active', 'suspended', 'churned']),
    }),
  ),
});
export const adminTenantsListTool: PersonaToolDescriptor<
  typeof TenantsListInput,
  typeof TenantsListOutput
> = {
  id: 'admin.tenants.list-recent',
  name: 'Admin — recent tenants',
  description: 'List recently created tenants across the platform.',
  personaSlugs: ADMIN,
  inputSchema: TenantsListInput,
  outputSchema: TenantsListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { tenants: [] };
    return client.get<{ tenants: Array<{ tenantId: string; displayName: string; createdAt: string; status: 'active' | 'suspended' | 'churned' }> }>(
      '/admin/tenants/recent',
      { query: { tenantId: ctx.tenantId, limit: input.limit } },
    );
  },
};

// 2. Audit-trail search
const AuditSearchInput = z.object({
  query: z.string().min(1).max(500),
  fromTs: z.string().optional(),
  toTs: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});
const AuditSearchOutput = z.object({
  entries: z.array(
    z.object({
      entryId: z.string(),
      tenantId: z.string(),
      actorId: z.string(),
      action: z.string(),
      occurredAt: z.string(),
    }),
  ),
  totalEntries: z.number().int().nonnegative(),
});
export const adminAuditSearchTool: PersonaToolDescriptor<
  typeof AuditSearchInput,
  typeof AuditSearchOutput
> = {
  id: 'admin.audit-trail.search',
  name: 'Admin — audit-trail search',
  description: 'Search the hash-chained audit trail with full-text + time range.',
  personaSlugs: ADMIN,
  inputSchema: AuditSearchInput,
  outputSchema: AuditSearchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { entries: [], totalEntries: 0 };
    return client.get<{ entries: Array<{ entryId: string; tenantId: string; actorId: string; action: string; occurredAt: string }>; totalEntries: number }>(
      '/admin/audit-trail/search',
      {
        query: {
          q: input.query,
          fromTs: input.fromTs,
          toTs: input.toTs,
          limit: input.limit,
        },
      },
    );
  },
};

// 3. Kill-switch status (HIGH risk — policy-rule literal)
const KillStatusInput = z.object({});
const KillStatusOutput = z.object({
  isOpen: z.boolean(),
  lastChangedAt: z.string(),
  lastChangedBy: z.string().optional(),
  reasonEn: z.string().optional(),
});
export const adminKillSwitchStatusTool: PersonaToolDescriptor<
  typeof KillStatusInput,
  typeof KillStatusOutput
> = {
  id: 'admin.kill-switch.status',
  name: 'Admin — kill-switch status',
  description:
    'Read the current state of the platform-wide kill-switch. HIGH-risk descriptor: ' +
    'the brain may NEVER generalise the response — surface the literal status only.',
  personaSlugs: ADMIN,
  inputSchema: KillStatusInput,
  outputSchema: KillStatusOutput,
  stakes: 'HIGH',
  isWrite: false,
  requiresPolicyRuleLiteral: true,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { isOpen: false, lastChangedAt: new Date().toISOString() };
    }
    return client.get<{ isOpen: boolean; lastChangedAt: string; lastChangedBy?: string; reasonEn?: string }>(
      '/admin/kill-switch/status',
      { query: { tenantId: ctx.tenantId } },
    );
  },
};

// 4. Pilot-errors recent
const PilotErrorsInput = z.object({
  limit: z.number().int().positive().max(100).default(50),
});
const PilotErrorsOutput = z.object({
  errors: z.array(
    z.object({
      errorId: z.string(),
      kind: z.string(),
      message: z.string(),
      tenantId: z.string().optional(),
      occurredAt: z.string(),
    }),
  ),
});
export const adminPilotErrorsTool: PersonaToolDescriptor<
  typeof PilotErrorsInput,
  typeof PilotErrorsOutput
> = {
  id: 'admin.pilot-errors.recent',
  name: 'Admin — recent pilot errors',
  description: 'Recent pilot-program error events surfaced for triage.',
  personaSlugs: ADMIN,
  inputSchema: PilotErrorsInput,
  outputSchema: PilotErrorsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { errors: [] };
    return client.get<{ errors: Array<{ errorId: string; kind: string; message: string; tenantId?: string; occurredAt: string }> }>(
      '/admin/pilot-errors',
      { query: { tenantId: ctx.tenantId, limit: input.limit } },
    );
  },
};

// 5. Corpus recent ingests
const CorpusIngestsInput = z.object({
  limit: z.number().int().positive().max(50).default(20),
});
const CorpusIngestsOutput = z.object({
  ingests: z.array(
    z.object({
      ingestId: z.string(),
      sourceUri: z.string(),
      chunks: z.number().int().nonnegative(),
      completedAt: z.string(),
    }),
  ),
});
export const adminCorpusIngestsTool: PersonaToolDescriptor<
  typeof CorpusIngestsInput,
  typeof CorpusIngestsOutput
> = {
  id: 'admin.corpus.recent-ingests',
  name: 'Admin — recent corpus ingests',
  description:
    'Recently-completed intelligence-corpus ingestion jobs (Borjie mining corpus + ' +
    'tenant uploads).',
  personaSlugs: ADMIN,
  inputSchema: CorpusIngestsInput,
  outputSchema: CorpusIngestsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { ingests: [] };
    return client.get<{ ingests: Array<{ ingestId: string; sourceUri: string; chunks: number; completedAt: string }> }>(
      '/admin/corpus/ingests',
      { query: { tenantId: ctx.tenantId, limit: input.limit } },
    );
  },
};

// 6. Feature flags list
const FeatureFlagsInput = z.object({});
const FeatureFlagsOutput = z.object({
  flags: z.array(
    z.object({
      key: z.string(),
      value: z.boolean(),
      rolloutPct: z.number().int().min(0).max(100).optional(),
    }),
  ),
});
export const adminFeatureFlagsTool: PersonaToolDescriptor<
  typeof FeatureFlagsInput,
  typeof FeatureFlagsOutput
> = {
  id: 'admin.feature-flags.list',
  name: 'Admin — feature flags',
  description: 'List all feature flags currently registered for the platform.',
  personaSlugs: ADMIN,
  inputSchema: FeatureFlagsInput,
  outputSchema: FeatureFlagsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { flags: [] };
    return client.get<{ flags: Array<{ key: string; value: boolean; rolloutPct?: number }> }>(
      '/admin/feature-flags',
      { query: { tenantId: ctx.tenantId } },
    );
  },
};

export const ADMIN_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  adminTenantsListTool,
  adminAuditSearchTool,
  adminKillSwitchStatusTool,
  adminPilotErrorsTool,
  adminCorpusIngestsTool,
  adminFeatureFlagsTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
