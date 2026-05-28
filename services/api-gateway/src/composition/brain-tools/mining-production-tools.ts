/**
 * Mining production brain tools — chat-as-OS parity for migration 0104.
 *
 * Three tools backing the `/api/v1/production/tonnage` family:
 *
 *   - `mining.production.log_tonnage`  WRITE: capture a tonnage event
 *   - `mining.production.daily_summary` READ:  daily aggregate
 *   - `mining.production.qa_backlog`    READ:  pending QA queue
 *
 * The WRITE tool is MEDIUM stakes (production figures roll into
 * royalty calculations and offtake settlements). It emits an audit
 * entry on every call via the gate's audit sink and forwards
 * `via=chat + sessionId + turnId` provenance to the explicit route
 * so the row's "via Mr. Mwikila" pill in the downstream UI deep-links
 * back to the originating chat turn (Chat-as-OS bidirectional parity
 * manifesto, principle 4).
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const MANAGER_OR_OWNER: ReadonlyArray<
  'T1_owner_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T3_module_manager'];

// ---------------------------------------------------------------------------
// 1. mining.production.log_tonnage (WRITE)
// ---------------------------------------------------------------------------

const LogTonnageInput = z.object({
  siteId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  oreTonnes: z.number().nonnegative(),
  wasteTonnes: z.number().nonnegative().default(0),
  stripRatio: z.number().nonnegative().optional(),
  source: z.enum(['field_app', 'plant_scale', 'manual_entry']),
  capturedAt: z.string().datetime().optional(),
  evidencePhotoIds: z.array(z.string().uuid()).max(20).default([]),
});
const LogTonnageOutput = z.object({
  id: z.string(),
  siteId: z.string(),
  oreTonnes: z.string(),
  wasteTonnes: z.string(),
  qaStatus: z.string(),
});
export const miningLogTonnageTool: PersonaToolDescriptor<
  typeof LogTonnageInput,
  typeof LogTonnageOutput
> = {
  id: 'mining.production.log_tonnage',
  name: 'Mining — log tonnage event',
  description:
    'Capture ore + waste tonnage from the field for the given site. Source ' +
    'attribution required (field_app / plant_scale / manual_entry). Emits ' +
    'an audit entry and lands a pending-QA row.',
  personaSlugs: MANAGER_OR_OWNER,
  inputSchema: LogTonnageInput,
  outputSchema: LogTonnageOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: '',
        siteId: input.siteId,
        oreTonnes: String(input.oreTonnes),
        wasteTonnes: String(input.wasteTonnes),
        qaStatus: 'pending',
      };
    }
    const response = await client.post<{
      success: boolean;
      data: Record<string, unknown>;
    }>(
      '/production/tonnage',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          siteId: input.siteId,
          shiftId: input.shiftId,
          oreTonnes: input.oreTonnes,
          wasteTonnes: input.wasteTonnes,
          stripRatio: input.stripRatio,
          source: input.source,
          capturedAt: input.capturedAt,
          evidencePhotoIds: input.evidencePhotoIds,
        },
        ctx,
      ),
    );
    const row = response.data ?? {};
    return {
      id: String(row.id ?? ''),
      siteId: String(row.site_id ?? input.siteId),
      oreTonnes: String(row.ore_tonnes ?? input.oreTonnes),
      wasteTonnes: String(row.waste_tonnes ?? input.wasteTonnes),
      qaStatus: String(row.qa_status ?? 'pending'),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. mining.production.daily_summary (READ)
// ---------------------------------------------------------------------------

const DailySummaryInput = z.object({
  siteId: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});
const DailySummaryOutput = z.object({
  forDate: z.string(),
  events: z.number().int(),
  totalOreTonnes: z.string(),
  totalWasteTonnes: z.string(),
  qaPending: z.number().int(),
  qaPassed: z.number().int(),
});
export const miningDailySummaryTool: PersonaToolDescriptor<
  typeof DailySummaryInput,
  typeof DailySummaryOutput
> = {
  id: 'mining.production.daily_summary',
  name: 'Mining — production daily summary',
  description:
    'Aggregate tonnage events for a given day across the tenant or one site. ' +
    'Read-only — defers to /production/tonnage/summary.',
  personaSlugs: MANAGER_OR_OWNER,
  inputSchema: DailySummaryInput,
  outputSchema: DailySummaryOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    if (!client) {
      return {
        forDate: date,
        events: 0,
        totalOreTonnes: '0',
        totalWasteTonnes: '0',
        qaPending: 0,
        qaPassed: 0,
      };
    }
    const response = await client.get<{
      success: boolean;
      data?: Record<string, unknown>;
    }>('/production/tonnage/summary', {
      query: { tenantId: ctx.tenantId, siteId: input.siteId, date },
    });
    const row = response.data ?? {};
    return {
      forDate: date,
      events: Number(row.events ?? 0),
      totalOreTonnes: String(row.total_ore_tonnes ?? '0'),
      totalWasteTonnes: String(row.total_waste_tonnes ?? '0'),
      qaPending: Number(row.qa_pending ?? 0),
      qaPassed: Number(row.qa_passed ?? 0),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. mining.production.qa_backlog (READ)
// ---------------------------------------------------------------------------

const QaBacklogInput = z.object({
  siteId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(100).default(20),
});
const QaBacklogOutput = z.object({
  pending: z.array(
    z.object({
      id: z.string(),
      siteId: z.string(),
      oreTonnes: z.string(),
      capturedAt: z.string(),
      source: z.string(),
    }),
  ),
});
export const miningQaBacklogTool: PersonaToolDescriptor<
  typeof QaBacklogInput,
  typeof QaBacklogOutput
> = {
  id: 'mining.production.qa_backlog',
  name: 'Mining — production QA backlog',
  description:
    'List tonnage events still awaiting supervisor QA sign-off. Read-only — ' +
    'filters /production/tonnage by qa_status=pending.',
  personaSlugs: MANAGER_OR_OWNER,
  inputSchema: QaBacklogInput,
  outputSchema: QaBacklogOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { pending: [] };
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/production/tonnage', {
      query: {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        limit: input.limit,
      },
    });
    const rows = (response.data ?? []).filter(
      (r) => String(r.qa_status) === 'pending',
    );
    return {
      pending: rows.slice(0, input.limit).map((r) => ({
        id: String(r.id),
        siteId: String(r.site_id),
        oreTonnes: String(r.ore_tonnes),
        capturedAt: String(r.captured_at),
        source: String(r.source),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Export catalogue.
// ---------------------------------------------------------------------------

export const MINING_PRODUCTION_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  miningLogTonnageTool,
  miningDailySummaryTool,
  miningQaBacklogTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
