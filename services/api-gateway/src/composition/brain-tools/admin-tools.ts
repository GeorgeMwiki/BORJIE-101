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
    // Retarget: canonical surface is GET /api/v1/mining/internal/tenants
    // (services/api-gateway/src/routes/mining/internal/tenants.hono.ts).
    // The internal-tenants router lists every platform tenant scoped to
    // the SUPER_ADMIN role; the brain tool slices the top `limit` rows.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/internal/tenants', { query: { limit: input.limit } });
    const rows = res.data ?? [];
    return {
      tenants: rows.map((r) => ({
        tenantId: String(r.id ?? r.tenant_id ?? ''),
        displayName: String(r.display_name ?? r.name ?? ''),
        createdAt: String(r.created_at ?? new Date().toISOString()),
        status:
          (String(r.status) as 'active' | 'suspended' | 'churned') ?? 'active',
      })),
    };
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
    // Retarget: canonical surface is GET /api/v1/audit-trail/entries
    // (services/api-gateway/src/routes/audit-trail.router.ts). The
    // brain tool surfaces row ids + actor + action + timestamp.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/audit-trail/entries', {
      query: {
        q: input.query,
        fromTs: input.fromTs,
        toTs: input.toTs,
        limit: input.limit,
      },
    });
    const rows = res.data ?? [];
    return {
      entries: rows.map((r) => ({
        entryId: String(r.id ?? ''),
        tenantId: String(r.tenant_id ?? ctx.tenantId),
        actorId: String(r.actor_id ?? r.user_id ?? ''),
        action: String(r.action ?? ''),
        occurredAt: String(r.created_at ?? r.occurred_at ?? new Date().toISOString()),
      })),
      totalEntries: rows.length,
    };
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
    // Retarget: canonical surface is GET /api/v1/mining/internal/killswitch
    // which lists kill-switch state rows for the platform. The brain
    // tool reads the most recent (newest-first ordering at source) and
    // surfaces literal {isOpen, lastChangedAt, lastChangedBy, reasonEn}.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/internal/killswitch', { query: { limit: 1 } });
    const latest = (res.data ?? [])[0] ?? {};
    return {
      isOpen: Boolean(latest.is_open ?? latest.isOpen ?? false),
      lastChangedAt: String(
        latest.updated_at ?? latest.created_at ?? new Date().toISOString(),
      ),
      ...(latest.changed_by_user_id
        ? { lastChangedBy: String(latest.changed_by_user_id) }
        : {}),
      ...(latest.reason
        ? { reasonEn: String(latest.reason) }
        : {}),
    };
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
    // Retarget: canonical surface is GET /api/v1/pilot/errors
    // (services/api-gateway/src/routes/pilot-errors.hono.ts). The
    // route gates to PILOT_ERROR_READ_ROLES (admin tiers).
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/pilot/errors', { query: { limit: input.limit } });
    const rows = res.data ?? [];
    return {
      errors: rows.map((r) => ({
        errorId: String(r.id ?? r.event_id ?? ''),
        kind: String(r.kind ?? r.error_type ?? 'unknown'),
        message: String(r.message ?? r.title ?? ''),
        ...(r.tenant_id ? { tenantId: String(r.tenant_id) } : {}),
        occurredAt: String(r.occurred_at ?? r.created_at ?? new Date().toISOString()),
      })),
    };
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
    // Retarget: canonical surface is GET /api/v1/mining/internal/corpus/versions
    // which lists corpus version rows (one per ingest job) newest-first.
    // The brain tool slices the top `limit` rows and surfaces source +
    // chunk count + completion timestamp.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/internal/corpus/versions', { query: { limit: input.limit } });
    const rows = res.data ?? [];
    return {
      ingests: rows.map((r) => ({
        ingestId: String(r.id ?? r.version_id ?? ''),
        sourceUri: String(r.source_uri ?? r.source ?? ''),
        chunks: Number(r.chunk_count ?? r.chunks ?? 0),
        completedAt: String(r.completed_at ?? r.created_at ?? new Date().toISOString()),
      })),
    };
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
    // Retarget: canonical surface is GET /api/v1/feature-flags
    // (services/api-gateway/src/routes/feature-flags.router.ts).
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/feature-flags');
    const rows = res.data ?? [];
    return {
      flags: rows.map((r) => ({
        key: String(r.key ?? r.flag_key ?? ''),
        value: Boolean(r.enabled ?? r.value ?? false),
        ...(typeof r.rollout_pct === 'number'
          ? { rolloutPct: r.rollout_pct }
          : typeof r.rolloutPct === 'number'
            ? { rolloutPct: r.rolloutPct }
            : {}),
      })),
    };
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
