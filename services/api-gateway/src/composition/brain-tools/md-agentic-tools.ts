/**
 * Agentic plan / subagent + sandbox-preview brain tools — chat-as-OS parity
 * for migration 0281.
 *
 * Seven tools backing `/api/v1/md-agentic/*`:
 *
 *   - plan.propose                 WRITE: persist a multi-step plan proposal
 *                                  (no execution — proposal only)
 *   - plan.dispatch_subagents      WRITE: dispatch a subagent team
 *                                  (honest-degrade: persists 'pending' runs)
 *   - plan.aggregate_results       READ:  aggregate persisted run results;
 *                                  returns 'unavailable' when no executor is
 *                                  wired — NEVER fabricates subagent output
 *   - sandbox.write                WRITE: STAGE a mutation for owner review
 *   - sandbox.list                 READ:  list staged writes for review
 *   - sandbox.commit               WRITE: validate payload + FK, atomic
 *                                  real-table write + audit row
 *   - sandbox.reject               WRITE: reject + rejection log
 *
 * The "preview-the-payload-before-it-lands" sandbox flow: the brain STAGES a
 * mutation in md_sandbox_writes → the owner reviews payload + rationale via
 * sandbox.list → the owner commits (atomic write to the real table + an
 * append-only md_sandbox_commits audit row) or rejects (md_sandbox_rejects
 * log). Sandbox target allowlist: the gap-2 org/team tables only
 * (staff_members / staff_kpis / org_tasks / org_escalations, mig 0280).
 *
 * Persona scope: T1 owner_strategist + T2 admin_strategist (the org operator
 * drives plans + sandbox commits from the owner / admin cockpit). The route
 * layer re-checks the role for defense in depth.
 *
 * Stakes: plan.propose / sandbox.write / sandbox.reject are MEDIUM (they
 * stage / log rows only). plan.dispatch_subagents is MEDIUM (persists pending
 * runs, no real spawn). sandbox.commit is HIGH — it performs the atomic write
 * into the real target table. plan.aggregate_results / sandbox.list are LOW
 * read-only. None carries a HIGH-risk policy prefix (sovereign / kill_switch /
 * four_eye / policy_rollout), so requiresPolicyRuleLiteral is false on all
 * seven.
 *
 * Honest-degrade (CLAUDE.md hard rule): when no loopback http client is bound
 * every handler returns a typed `unavailable` / empty shape — never a
 * fabricated row. The route itself is the source of truth.
 *
 * Multi-currency (CLAUDE.md hard rule): a staged payload that carries money is
 * opaque to this layer; no jurisdiction currency is hard-coded.
 *
 * Ported from the BN md-agentic chat tools (itself a LitFin iter-32 plan-mode +
 * iter-36 agent-teams / sandbox-writes port) and retargeted to the
 * mining-estate domain.
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_ADMIN: ReadonlyArray<'T1_owner_strategist' | 'T2_admin_strategist'> =
  ['T1_owner_strategist', 'T2_admin_strategist'];

const SANDBOX_TABLES = [
  'staff_members',
  'staff_kpis',
  'org_tasks',
  'org_escalations',
] as const;

// ---------------------------------------------------------------------------
// 1. plan.propose (WRITE)
// ---------------------------------------------------------------------------

const ProposeInput = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(4000),
  steps: z
    .array(
      z.object({
        tool: z.string().min(1).max(200),
        input: z.record(z.unknown()),
        rationale: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(25),
  estimatedImpact: z.string().max(4000).optional(),
});

const ProposeOutput = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  stepCount: z.number(),
});

export const planProposeTool: PersonaToolDescriptor<
  typeof ProposeInput,
  typeof ProposeOutput
> = {
  id: 'plan.propose',
  name: 'Plan — propose a multi-step plan (en) / Mpango — pendekeza mpango wa hatua (sw)',
  description:
    'Propose a multi-step plan for the owner to approve in chat (Claude-' +
    'Code "plan mode"). Use when a request needs several governed steps — ' +
    '"draft a Q3 hiring plan", "lay out the demobilization workflow for the ' +
    'north pit crew". title + summary + at least one step required (re-ask if ' +
    'missing — never invent). Each step is { tool, input, rationale }. This ' +
    'ONLY persists the proposal; it does NOT execute. Approved steps run ' +
    'later through the normal tier-policy pipeline.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: ProposeInput,
  outputSchema: ProposeOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      id: '',
      title: input.title,
      status: 'unavailable',
      stepCount: input.steps.length,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const body: Record<string, unknown> = {
      title: input.title,
      summary: input.summary,
      steps: input.steps,
    };
    if (input.estimatedImpact !== undefined) {
      body.estimatedImpact = input.estimatedImpact;
    }

    const response = await client.post<{
      success: boolean;
      data?: Record<string, unknown>;
    }>('/md-agentic/plans', withChatProvenance(body, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? input.title),
      status: String(row.status ?? 'proposed'),
      stepCount: Number(row.step_count ?? input.steps.length),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. plan.dispatch_subagents (WRITE — honest-degrade)
// ---------------------------------------------------------------------------

const DispatchInput = z.object({
  brief: z.string().min(20).max(12000),
  aggregation: z
    .enum(['majority_vote', 'best_of_n', 'merge_all', 'first_success'])
    .optional(),
  members: z
    .array(
      z.object({
        role: z.enum([
          'explorer',
          'reviewer',
          'synthesizer',
          'researcher',
          'executor',
        ]),
        brief: z.string().min(20).max(12000),
        allowedTools: z.array(z.string().min(1)).optional(),
        tokenBudget: z.number().int().positive().max(80000).optional(),
      }),
    )
    .min(2)
    .max(8),
  planId: z.string().uuid().optional(),
});

const DispatchOutput = z.object({
  teamRunId: z.string(),
  status: z.string(),
  aggregation: z.string(),
  memberCount: z.number(),
  memberIds: z.array(z.string()),
});

export const planDispatchSubagentsTool: PersonaToolDescriptor<
  typeof DispatchInput,
  typeof DispatchOutput
> = {
  id: 'plan.dispatch_subagents',
  name: 'Plan — dispatch a subagent team (en) / Mpango — tuma timu ya wasaidizi (sw)',
  description:
    'Dispatch a team of subagents (Claude-Code "agent teams"). Use for a ' +
    'fan-out task — several roles working a shared brief in parallel. ' +
    '2–8 members, each { role, brief, allowedTools?, tokenBudget? }; roles: ' +
    'explorer, reviewer, synthesizer, researcher, executor (executor needs ' +
    'allowedTools). aggregation: majority_vote, best_of_n, merge_all, ' +
    'first_success (default merge_all). HONEST: runs persist at status ' +
    "'pending'; results appear via plan.aggregate_results once an executor " +
    'completes them — output is NEVER fabricated.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: DispatchInput,
  outputSchema: DispatchOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      teamRunId: '',
      status: 'unavailable',
      aggregation: input.aggregation ?? 'merge_all',
      memberCount: input.members.length,
      memberIds: [] as string[],
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const body: Record<string, unknown> = {
      brief: input.brief,
      members: input.members,
    };
    if (input.aggregation !== undefined) body.aggregation = input.aggregation;
    if (input.planId !== undefined) body.planId = input.planId;

    const response = await client.post<{
      success: boolean;
      data?: Record<string, unknown>;
    }>('/md-agentic/subagents/dispatch', withChatProvenance(body, ctx));
    const row = response.data;
    if (!row) return unavailable;
    const memberIds = Array.isArray(row.memberIds)
      ? (row.memberIds as unknown[]).map((m) => String(m))
      : [];
    return {
      teamRunId: String(row.teamRunId ?? ''),
      status: String(row.status ?? 'pending'),
      aggregation: String(row.aggregation ?? input.aggregation ?? 'merge_all'),
      memberCount: Number(row.memberCount ?? input.members.length),
      memberIds,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. plan.aggregate_results (READ — honest-degrade, never fabricates)
// ---------------------------------------------------------------------------

const AggregateInput = z.object({
  teamRunId: z.string().uuid(),
});

const AggregateOutput = z.object({
  teamRunId: z.string(),
  status: z.string(),
  aggregation: z.string(),
  memberCount: z.number(),
  completedCount: z.number(),
  failedCount: z.number(),
  pendingCount: z.number(),
  executorWired: z.boolean(),
  results: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
      status: z.string(),
    }),
  ),
});

export const planAggregateResultsTool: PersonaToolDescriptor<
  typeof AggregateInput,
  typeof AggregateOutput
> = {
  id: 'plan.aggregate_results',
  name: 'Plan — aggregate subagent results (en) / Mpango — kusanya matokeo ya wasaidizi (sw)',
  description:
    'Read + aggregate a subagent team\'s results by teamRunId. Read-only — ' +
    'defers to GET /md-agentic/subagents/:teamRunId/aggregate. HONEST: if ' +
    'no executor is wired the runs stay pending and this reports status ' +
    "'unavailable' with executorWired=false — it NEVER invents results. " +
    'Once members complete it applies the team aggregation (majority_vote / ' +
    'best_of_n / merge_all / first_success).',
  personaSlugs: OWNER_ADMIN,
  inputSchema: AggregateInput,
  outputSchema: AggregateOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      teamRunId: input.teamRunId,
      status: 'unavailable',
      aggregation: 'merge_all',
      memberCount: 0,
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      executorWired: false,
      results: [] as Array<{ id: string; role: string; status: string }>,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const response = await client.get<{
      success: boolean;
      data?: Record<string, unknown>;
    }>(
      `/md-agentic/subagents/${encodeURIComponent(input.teamRunId)}/aggregate`,
    );
    const data = response.data;
    if (!data) return unavailable;
    const rawResults = Array.isArray(data.results) ? data.results : [];
    return {
      teamRunId: input.teamRunId,
      status: String(data.status ?? 'unknown'),
      aggregation: String(data.aggregation ?? 'merge_all'),
      memberCount: Number(data.memberCount ?? 0),
      completedCount: Number(data.completedCount ?? 0),
      failedCount: Number(data.failedCount ?? 0),
      pendingCount: Number(data.pendingCount ?? 0),
      executorWired: data.executorWired === true,
      results: (rawResults as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id ?? ''),
        role: String(r.role ?? ''),
        status: String(r.status ?? ''),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 4. sandbox.write (WRITE — stage)
// ---------------------------------------------------------------------------

const SandboxWriteInput = z.object({
  targetTable: z.enum(SANDBOX_TABLES),
  operation: z.enum(['insert', 'update']),
  targetRowId: z.string().uuid().optional(),
  proposedPayload: z.record(z.unknown()),
  rationale: z.string().max(4000).optional(),
  planId: z.string().uuid().optional(),
});

const SandboxWriteOutput = z.object({
  sandboxId: z.string(),
  targetTable: z.string(),
  operation: z.string(),
  status: z.string(),
  expiresAt: z.string().nullable(),
});

export const sandboxWriteTool: PersonaToolDescriptor<
  typeof SandboxWriteInput,
  typeof SandboxWriteOutput
> = {
  id: 'sandbox.write',
  name: 'Sandbox — stage a write for review (en) / Sanduku — andaa andiko kwa ukaguzi (sw)',
  description:
    'STAGE a write to a real table for the owner to review BEFORE it ' +
    'lands. Use when a change deserves a preview — "stage a new safety ' +
    'officer for my review", "draft an update to this KPI". targetTable: ' +
    'staff_members, staff_kpis, org_tasks, org_escalations. operation: ' +
    'insert | update (update needs targetRowId). proposedPayload uses the ' +
    "table's snake_case columns; reserved columns (id / tenant_id / " +
    'timestamps) are stripped at commit. rationale tells the owner WHY. ' +
    'Nothing lands until sandbox.commit.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: SandboxWriteInput,
  outputSchema: SandboxWriteOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      sandboxId: '',
      targetTable: input.targetTable,
      operation: input.operation,
      status: 'unavailable',
      expiresAt: null as string | null,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const body: Record<string, unknown> = {
      targetTable: input.targetTable,
      operation: input.operation,
      proposedPayload: input.proposedPayload,
    };
    if (input.targetRowId !== undefined) body.targetRowId = input.targetRowId;
    if (input.rationale !== undefined) body.rationale = input.rationale;
    if (input.planId !== undefined) body.planId = input.planId;

    const response = await client.post<{
      success: boolean;
      data?: Record<string, unknown>;
    }>('/md-agentic/sandbox/writes', withChatProvenance(body, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      sandboxId: String(row.id ?? ''),
      targetTable: String(row.target_table ?? input.targetTable),
      operation: String(row.operation ?? input.operation),
      status: String(row.status ?? 'pending'),
      expiresAt: row.expires_at != null ? String(row.expires_at) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. sandbox.list (READ)
// ---------------------------------------------------------------------------

const SandboxListInput = z.object({
  status: z
    .enum(['pending', 'committed', 'rejected', 'expired', 'all'])
    .optional(),
  targetTable: z.enum([...SANDBOX_TABLES, 'all']).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const SandboxListOutput = z.object({
  statusFilter: z.string(),
  tableFilter: z.string(),
  count: z.number(),
  sandboxWrites: z.array(
    z.object({
      id: z.string(),
      targetTable: z.string(),
      operation: z.string(),
      status: z.string(),
      rationale: z.string().nullable(),
      expiresAt: z.string().nullable(),
    }),
  ),
});

export const sandboxListTool: PersonaToolDescriptor<
  typeof SandboxListInput,
  typeof SandboxListOutput
> = {
  id: 'sandbox.list',
  name: 'Sandbox — list staged writes (en) / Sanduku — orodha ya maandiko yaliyoandaliwa (sw)',
  description:
    'List staged sandbox writes so the owner can review what the brain ' +
    'wants to do before committing or rejecting. Read-only — defers to ' +
    'GET /md-agentic/sandbox/writes. Default lists pending writes; pass ' +
    'status (pending / committed / rejected / expired / all) and/or ' +
    'targetTable to filter. Each row carries its proposed payload + ' +
    'rationale for the owner to scan.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: SandboxListInput,
  outputSchema: SandboxListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const empty = {
      statusFilter: input.status ?? 'pending',
      tableFilter: input.targetTable ?? 'all',
      count: 0,
      sandboxWrites: [] as Array<{
        id: string;
        targetTable: string;
        operation: string;
        status: string;
        rationale: string | null;
        expiresAt: string | null;
      }>,
    };
    const client = ctx.httpClient;
    if (!client) return empty;

    const query: Record<string, string | number | undefined> = {};
    if (input.status !== undefined) query.status = input.status;
    if (input.targetTable !== undefined) query.targetTable = input.targetTable;
    if (input.limit !== undefined) query.limit = input.limit;

    const response = await client.get<{
      success: boolean;
      data?: {
        statusFilter?: string;
        tableFilter?: string;
        count?: number;
        sandboxWrites?: ReadonlyArray<Record<string, unknown>>;
      };
    }>('/md-agentic/sandbox/writes', { query });
    const data = response.data;
    if (!data) return empty;
    const rows = data.sandboxWrites ?? [];
    return {
      statusFilter: String(data.statusFilter ?? input.status ?? 'pending'),
      tableFilter: String(data.tableFilter ?? input.targetTable ?? 'all'),
      count: Number(data.count ?? rows.length),
      sandboxWrites: rows.map((r) => ({
        id: String(r.id ?? ''),
        targetTable: String(r.target_table ?? ''),
        operation: String(r.operation ?? ''),
        status: String(r.status ?? ''),
        rationale: r.rationale != null ? String(r.rationale) : null,
        expiresAt: r.expires_at != null ? String(r.expires_at) : null,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 6. sandbox.commit (WRITE — validate + atomic real-table write + audit)
// ---------------------------------------------------------------------------

const SandboxCommitInput = z.object({
  sandboxId: z.string().uuid(),
});

const SandboxCommitOutput = z.object({
  sandboxId: z.string(),
  targetTable: z.string(),
  operation: z.string(),
  targetRowId: z.string().nullable(),
  hasSnapshot: z.boolean(),
  status: z.string(),
});

export const sandboxCommitTool: PersonaToolDescriptor<
  typeof SandboxCommitInput,
  typeof SandboxCommitOutput
> = {
  id: 'sandbox.commit',
  name: 'Sandbox — commit a staged write (en) / Sanduku — thibitisha andiko (sw)',
  description:
    'Commit a staged sandbox write to its real table once the owner ' +
    'approves ("yes, apply that"). The route VALIDATES the staged payload ' +
    '(shape + FK existence) BEFORE the atomic write, then records an ' +
    'append-only audit row. HIGH-stakes — this is the moment a staged ' +
    'mutation lands. NOT_FOUND for a missing / cross-tenant id; refuses an ' +
    'already-committed / rejected / expired row. Defers to ' +
    'POST /md-agentic/sandbox/writes/:id/commit.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: SandboxCommitInput,
  outputSchema: SandboxCommitOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      sandboxId: input.sandboxId,
      targetTable: '',
      operation: '',
      targetRowId: null as string | null,
      hasSnapshot: false,
      status: 'unavailable',
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const response = await client.post<{
      success: boolean;
      data?: Record<string, unknown>;
    }>(
      `/md-agentic/sandbox/writes/${encodeURIComponent(
        input.sandboxId,
      )}/commit`,
      withChatProvenance({}, ctx),
    );
    const row = response.data;
    if (!row) return unavailable;
    return {
      sandboxId: String(row.sandboxId ?? input.sandboxId),
      targetTable: String(row.targetTable ?? ''),
      operation: String(row.operation ?? ''),
      targetRowId: row.targetRowId != null ? String(row.targetRowId) : null,
      hasSnapshot: row.hasSnapshot === true,
      status: 'committed',
    };
  },
};

// ---------------------------------------------------------------------------
// 7. sandbox.reject (WRITE — rejection log)
// ---------------------------------------------------------------------------

const SandboxRejectInput = z.object({
  sandboxId: z.string().uuid(),
  reason: z.string().min(1).max(4000),
});

const SandboxRejectOutput = z.object({
  sandboxId: z.string(),
  targetTable: z.string(),
  previousStatus: z.string(),
  status: z.string(),
});

export const sandboxRejectTool: PersonaToolDescriptor<
  typeof SandboxRejectInput,
  typeof SandboxRejectOutput
> = {
  id: 'sandbox.reject',
  name: 'Sandbox — reject a staged write (en) / Sanduku — kataa andiko (sw)',
  description:
    'Reject a staged sandbox write when the owner says "no, cancel that". ' +
    'The row flips to rejected with the reason recorded in the rejection ' +
    'log; the real target table is NEVER touched. reason is required (the ' +
    'owner must say why). Refuses an already-terminal row. Defers to ' +
    'POST /md-agentic/sandbox/writes/:id/reject.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: SandboxRejectInput,
  outputSchema: SandboxRejectOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      sandboxId: input.sandboxId,
      targetTable: '',
      previousStatus: 'unknown',
      status: 'unavailable',
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const response = await client.post<{
      success: boolean;
      data?: Record<string, unknown>;
    }>(
      `/md-agentic/sandbox/writes/${encodeURIComponent(
        input.sandboxId,
      )}/reject`,
      withChatProvenance({ reason: input.reason }, ctx),
    );
    const row = response.data;
    if (!row) return unavailable;
    return {
      sandboxId: String(row.sandboxId ?? input.sandboxId),
      targetTable: String(row.targetTable ?? ''),
      previousStatus: String(row.previousStatus ?? 'unknown'),
      status: String(row.status ?? 'rejected'),
    };
  },
};

// ---------------------------------------------------------------------------
// Catalog export — included by `buildPersonaToolHandlers` in index.ts.
// ---------------------------------------------------------------------------

export const MD_AGENTIC_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  planProposeTool,
  planDispatchSubagentsTool,
  planAggregateResultsTool,
  sandboxWriteTool,
  sandboxListTool,
  sandboxCommitTool,
  sandboxRejectTool,
] as unknown as ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
>);
