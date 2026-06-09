/**
 * MD DEFERRAL brain tools — Mr. Mwikila's "defer with intent + hold a durable
 * backlog + confirm it actually happened" surface.
 *
 *   1. md.defer                — DEFER a task in plain language ("handle the
 *                                royalty filing after settlement lands"). A
 *                                durable commitment is persisted with its typed
 *                                WAIT-FOR trigger (time | event | condition).
 *   2. md.commitment.create    — explicit, fully-specified create (same store).
 *   3. md.commitment.list      — list the live backlog (the MD's open threads).
 *   4. md.commitment.update    — re-schedule / re-classify / change rung intent.
 *   5. md.commitment.confirm   — close ONLY on positive proof (the owner
 *                                confirms it happened); honest closure, never
 *                                optimistic.
 *
 * The store is the durable `md_commitments` ledger (migration 0321). An LLM
 * brain has NO native prospective memory, so the deferral is externalised as a
 * first-class durable row the moment it is formed and brought back by the
 * EstateMind RECONCILE sweep — never held in a prompt.
 *
 * GOVERNANCE:
 *   - Evidence-required: every commitment cites >=1 evidence id (enforced at
 *     the repository row boundary; the tool surfaces the requirement).
 *   - Sovereign (licence/royalty/money/deletion) commitments are HITL forever —
 *     the tool can TRACK / SCHEDULE / list / confirm them; it can NEVER
 *     auto-actuate. Closing a sovereign commitment requires a positive proof.
 *   - Tenant isolation: handlers resolve `tenantId` from the tool-execution
 *     context; the repository scopes every read/write to that tenant.
 *   - Bilingual absolutism: a commitment carries complete EN + SW title.
 *
 * Persona binding: owner strategist (T1) + admin strategist (T2) (admins
 * dogfood the same backlog when debugging an owner's session).
 */

import { z } from 'zod';

import type {
  MdCommitmentRepository,
  CreateMdCommitmentInput,
  MdCommitment,
} from '@borjie/database/repositories';
import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

interface ToolDeps {
  readonly repo: MdCommitmentRepository;
}

let injectedDeps: ToolDeps | null = null;

/**
 * Wire the durable commitment repository at composition time. Called once from
 * the api-gateway composition root (next to the other `configureX` tool wires).
 */
export function configureMdDeferTools(deps: ToolDeps): void {
  injectedDeps = Object.freeze({ repo: deps.repo });
}

function requireRepo(): MdCommitmentRepository {
  if (!injectedDeps) {
    throw new Error(
      'md-defer-tools: configureMdDeferTools(deps) was not called at composition time',
    );
  }
  return injectedDeps.repo;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const ClassEnum = z.enum([
  'next_action',
  'waiting_for',
  'tickler',
  'someday',
]);
const TriggerKindEnum = z.enum(['time', 'event', 'condition']);

const TriggerSpecShape = z
  .object({
    dueAt: z.string().datetime().optional(),
    eventKey: z.string().min(1).max(120).optional(),
    predicate: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const CommitmentView = z.object({
  id: z.string(),
  class: z.string(),
  kind: z.string(),
  title: z.string(),
  titleSw: z.string(),
  rationale: z.string(),
  triggerKind: z.string(),
  status: z.string(),
  rungLevel: z.number().int(),
  sovereign: z.boolean(),
  triggerDueAt: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  confirmedAt: z.string().nullable(),
  confirmationKind: z.string().nullable(),
});

function toView(c: MdCommitment): z.infer<typeof CommitmentView> {
  return {
    id: c.id,
    class: c.class,
    kind: c.kind,
    title: c.title,
    titleSw: c.titleSw,
    rationale: c.rationale,
    triggerKind: c.triggerKind,
    status: c.status,
    rungLevel: c.rungLevel,
    sovereign: c.sovereign,
    triggerDueAt:
      c.triggerDueAtMs !== null ? new Date(c.triggerDueAtMs).toISOString() : null,
    evidenceIds: [...c.evidenceIds],
    confirmedAt:
      c.confirmedAtMs !== null ? new Date(c.confirmedAtMs).toISOString() : null,
    confirmationKind: c.confirmationKind,
  };
}

/** Build a stable idempotency key from the call so a repeat never double-creates. */
function idemKeyFrom(parts: ReadonlyArray<string>): string {
  const serialised = parts.join('|');
  let hash = 5381;
  for (let i = 0; i < serialised.length; i += 1) {
    hash = ((hash << 5) + hash + serialised.charCodeAt(i)) | 0;
  }
  return `defer:${(hash >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// 1. md.defer — the plain-language deferral
// ---------------------------------------------------------------------------

const DeferInput = z
  .object({
    title: z.string().min(3).max(200),
    titleSw: z.string().min(3).max(200),
    rationale: z.string().min(3).max(1000),
    /** GTD class — defaults to waiting_for for an event/condition deferral. */
    class: ClassEnum.optional(),
    kind: z.string().min(1).max(80).optional(),
    triggerKind: TriggerKindEnum,
    triggerSpec: TriggerSpecShape,
    /** >=1 evidence id (evidence-required hard rule). */
    evidenceIds: z.array(z.string().min(1).max(120)).min(1).max(20),
    /** licence/royalty/money/deletion → HITL forever (safe-halt at the top rung). */
    sovereign: z.boolean().optional(),
    /** Optional explicit idempotency key (else derived from the call). */
    idempotencyKey: z.string().min(1).max(120).optional(),
    threadId: z.string().min(1).max(120).optional(),
  })
  .strict();

const DeferOutput = z.object({ commitment: CommitmentView });

export const mdDeferTool: PersonaToolDescriptor<
  typeof DeferInput,
  typeof DeferOutput
> = {
  id: 'md.defer',
  name: 'MD — defer a task',
  description:
    'DEFER a task to a durable backlog with intent, in plain language: "handle ' +
    'the royalty filing after the buyer settlement lands". Persist a commitment ' +
    'with a typed WAIT-FOR trigger — time ({dueAt}), event ({eventKey} e.g. ' +
    '"ledger.credit" / "offtake.settled"), or condition ({predicate}). The ' +
    'EstateMind reconcile sweep brings it back on the right trigger, climbs a ' +
    'reminder ladder if ignored, and follows through to a confirmed close. ' +
    'Requires >=1 evidence id. Mark sovereign=true for licence/royalty/money/ ' +
    'deletion (HITL forever — never auto-actuated).',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: DeferInput,
  outputSchema: DeferOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const repo = requireRepo();
    const dueAt = input.triggerSpec.dueAt ?? null;
    // Strip undefined keys so the spec satisfies exactOptionalPropertyTypes.
    const triggerSpec = {
      ...(input.triggerSpec.dueAt !== undefined && {
        dueAt: input.triggerSpec.dueAt,
      }),
      ...(input.triggerSpec.eventKey !== undefined && {
        eventKey: input.triggerSpec.eventKey,
      }),
      ...(input.triggerSpec.predicate !== undefined && {
        predicate: input.triggerSpec.predicate,
      }),
    };
    const create: CreateMdCommitmentInput = {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      threadId: input.threadId ?? ctx.chatSessionId ?? null,
      class: input.class ?? (input.triggerKind === 'time' ? 'tickler' : 'waiting_for'),
      kind: input.kind ?? 'general',
      title: input.title,
      titleSw: input.titleSw,
      rationale: input.rationale,
      evidenceIds: input.evidenceIds,
      triggerKind: input.triggerKind,
      triggerSpec,
      triggerDueAt: dueAt,
      sovereign: input.sovereign ?? false,
      idempotencyKey:
        input.idempotencyKey ??
        idemKeyFrom([ctx.tenantId, input.title, input.triggerKind]),
    };
    const commitment = await repo.create(create);
    return { commitment: toView(commitment) };
  },
};

// ---------------------------------------------------------------------------
// 2. md.commitment.create — explicit create (alias surface)
// ---------------------------------------------------------------------------

export const mdCommitmentCreateTool: PersonaToolDescriptor<
  typeof DeferInput,
  typeof DeferOutput
> = {
  ...mdDeferTool,
  id: 'md.commitment.create',
  name: 'MD commitment — create',
  description:
    'Explicitly create an MD commitment in the durable backlog (the fully-' +
    'specified form of md.defer). Same store, same governance: typed WAIT-FOR ' +
    'trigger, >=1 evidence id, sovereign → HITL forever.',
};

// ---------------------------------------------------------------------------
// 3. md.commitment.list — the live backlog
// ---------------------------------------------------------------------------

const ListInput = z
  .object({
    statusFilter: z
      .enum(['open', 'scheduled', 'overdue', 'blocked', 'reopened'])
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const ListOutput = z.object({
  commitments: z.array(CommitmentView),
});

export const mdCommitmentListTool: PersonaToolDescriptor<
  typeof ListInput,
  typeof ListOutput
> = {
  id: 'md.commitment.list',
  name: 'MD commitment — list backlog',
  description:
    'List the live MD commitment backlog (open threads the brain is tracking). ' +
    'Use when the owner asks "what are you still chasing?" or before answering a ' +
    'strategic question, so nothing deferred is dropped. Optional statusFilter.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ListInput,
  outputSchema: ListOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const repo = requireRepo();
    const live = await repo.listLive(ctx.tenantId);
    const filtered = input.statusFilter
      ? live.filter((c) => c.status === input.statusFilter)
      : live;
    const limit = input.limit ?? 50;
    return {
      commitments: filtered.slice(0, limit).map(toView),
    };
  },
};

// ---------------------------------------------------------------------------
// 4. md.commitment.update — re-schedule / re-classify
// ---------------------------------------------------------------------------

const UpdateInput = z
  .object({
    id: z.string().min(1).max(120),
    /** New honest lifecycle status (never 'done' — that needs proof via confirm). */
    status: z
      .enum(['open', 'scheduled', 'overdue', 'blocked', 'reopened'])
      .optional(),
    /** Block with an honest reason. */
    blockedReason: z.string().min(1).max(500).optional(),
  })
  .strict();

const UpdateOutput = z.object({
  commitment: CommitmentView.nullable(),
});

export const mdCommitmentUpdateTool: PersonaToolDescriptor<
  typeof UpdateInput,
  typeof UpdateOutput
> = {
  id: 'md.commitment.update',
  name: 'MD commitment — update',
  description:
    'Update a live MD commitment: re-schedule, re-classify, or block it with an ' +
    'honest reason. CANNOT mark it done — closing a commitment requires positive ' +
    'proof via md.commitment.confirm (honest status, never optimistic).',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UpdateInput,
  outputSchema: UpdateOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const repo = requireRepo();
    if (input.blockedReason) {
      const blocked = await repo.block(ctx.tenantId, input.id, input.blockedReason);
      return { commitment: blocked ? toView(blocked) : null };
    }
    if (input.status) {
      const next = await repo.transition(ctx.tenantId, input.id, {
        status: input.status,
      });
      return { commitment: next ? toView(next) : null };
    }
    const current = await repo.get(ctx.tenantId, input.id);
    return { commitment: current ? toView(current) : null };
  },
};

// ---------------------------------------------------------------------------
// 5. md.commitment.confirm — close ONLY on positive proof
// ---------------------------------------------------------------------------

const ConfirmInput = z
  .object({
    id: z.string().min(1).max(120),
    /** The proof — 'regulator_ack' | 'ledger_entry' | 'owner_approved' | ... */
    confirmationKind: z.string().min(2).max(80),
  })
  .strict();

const ConfirmOutput = z.object({
  commitment: CommitmentView.nullable(),
});

export const mdCommitmentConfirmTool: PersonaToolDescriptor<
  typeof ConfirmInput,
  typeof ConfirmOutput
> = {
  id: 'md.commitment.confirm',
  name: 'MD commitment — confirm done',
  description:
    'Close an MD commitment ONLY on positive proof that it actually happened ' +
    '(regulator ack / ledger entry / owner approval). Honest closure: a ' +
    'commitment is never marked done without a confirmationKind. Use when the ' +
    'owner confirms a deferred task is genuinely complete.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ConfirmInput,
  outputSchema: ConfirmOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const repo = requireRepo();
    const done = await repo.markDone(ctx.tenantId, input.id, {
      confirmationKind: input.confirmationKind,
    });
    return { commitment: done ? toView(done) : null };
  },
};

// ---------------------------------------------------------------------------
// Catalog export
// ---------------------------------------------------------------------------

export const MD_DEFER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  mdDeferTool,
  mdCommitmentCreateTool,
  mdCommitmentListTool,
  mdCommitmentUpdateTool,
  mdCommitmentConfirmTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
