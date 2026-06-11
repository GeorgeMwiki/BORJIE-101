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

import { orchestrator } from '@borjie/central-intelligence';
import type {
  MdCommitmentRepository,
  CreateMdCommitmentInput,
  MdCommitmentCreateGapInput,
  MdCommitment,
} from '@borjie/database/repositories';
import type { PersonaToolDescriptor } from './types';
import type { TimelineSink } from '../living-md/timeline-event-sink';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

interface ToolDeps {
  readonly repo: MdCommitmentRepository;
  /**
   * The LIVING-MD organ's append-only lifecycle trail. Optional — when wired
   * (composition root), confirm/reopen write the timeline IN LOCKSTEP with the
   * ledger transition (closure-by-confirmation made forensic). Best-effort: the
   * sink never throws, so an absent / faulting sink never breaks a tool call.
   */
  readonly timelineSink?: TimelineSink | null;
}

let injectedDeps: ToolDeps | null = null;

/**
 * Wire the durable commitment repository at composition time. Called once from
 * the api-gateway composition root (next to the other `configureX` tool wires).
 * The optional `timelineSink` lights up the LIVING-MD lifecycle trail so a
 * confirm/reopen records an append-only, hash-chained timeline row.
 */
export function configureMdDeferTools(deps: ToolDeps): void {
  injectedDeps = Object.freeze({
    repo: deps.repo,
    timelineSink: deps.timelineSink ?? null,
  });
}

/** The timeline sink (or null) wired at composition time. */
function timelineSink(): TimelineSink | null {
  return injectedDeps?.timelineSink ?? null;
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
// Capability-Gap DETECTION SEAM (W2e — Loop A goes LIVE).
//
// The kernel's tool-dispatcher already detects a tool-resolution miss (a
// NOT_YET_WIRED organ surfaces as `executor-failed`; an absent tool as
// `not-found`) and, when a `GapDetectorPort` is wired, files a durable
// capability gap BEFORE returning the (still-failing) `tool_error`. Until now
// that port had ZERO live callers, so the Capability Gap Register was dark and
// the self-developing loop never started.
//
// `createMdGapDetector(repo)` is that missing live adapter. It derives a
// `MdCommitmentCreateGapInput` GENERATIVELY from the miss — the missing tool
// name IS the blocker, so the gap is keyed on it; the unblock trigger is
// `tool_registered:<toolName>` (the watcher re-fires when the organ wires); the
// competence domain is the tool's namespace segment. NOTHING is per-case
// hardcoded: any unseen tool name produces a correct gap row.
//
// Fail-safe + additive: the kernel seam swallows any throw from this port, so a
// detector fault NEVER changes the dispatch result (the tool keeps failing
// honestly while the gap is durably filed). `createGap` is idempotent on
// (tenantId, idempotencyKey), so a tool that misses every tick files exactly
// ONE gap row, not a storm.
// ---------------------------------------------------------------------------

/**
 * Derive the jagged-frontier competence coordinate from a tool name. The
 * leading namespace segment (everything before the first `.`/`:`/`_`) is the
 * organ family the gap belongs to (e.g. `platform.suspend_licence` → `platform`,
 * `royalty:file-return` → `royalty`). Generative — never an allow-list. Returns
 * `null` for an unnamespaced bareword so the row simply omits the coordinate.
 */
export function competenceDomainFromTool(toolName: string): string | null {
  const head = toolName.split(/[.:_/]/, 1)[0]?.trim().toLowerCase();
  return head && head.length > 0 ? head : null;
}

/** Bilingual gap titles + rationale derived from the miss (no per-case copy). */
function gapNarrative(
  toolName: string,
  gapKind: 'unwired_organ' | 'missing_tool',
): { title: string; titleSw: string; rationale: string } {
  if (gapKind === 'missing_tool') {
    return {
      title: `Capability gap: tool "${toolName}" is not registered yet`,
      titleSw: `Pengo la uwezo: zana "${toolName}" bado haijasajiliwa`,
      rationale:
        `Mr. Mwikila reached for "${toolName}" but the dispatcher could not ` +
        `resolve it (no such tool). Recording the gap so the self-developing ` +
        `loop can build or register the capability; it clears when the tool ` +
        `registers.`,
    };
  }
  return {
    title: `Capability gap: organ "${toolName}" is wired but not yet operational`,
    titleSw: `Pengo la uwezo: kiungo "${toolName}" kimeunganishwa lakini bado hakifanyi kazi`,
    rationale:
      `Mr. Mwikila invoked "${toolName}" but its executor is not yet wired ` +
      `(executor-failed). Recording the gap so the self-developing loop can ` +
      `complete the organ; it clears when the executor goes live.`,
  };
}

/**
 * Build the LIVE `GapDetectorPort` over the durable commitment repository. Wired
 * once at composition time into `createToolDispatcher({ gapDetector })`. Every
 * field of the gap row is derived from the miss — the same adapter serves a
 * tool-resolution miss, a NOT_YET_WIRED organ, and (by gapKind) a future
 * missing-evidence outcome with zero per-case branching.
 */
export function createMdGapDetector(
  repo: MdCommitmentRepository,
  logger?: {
    warn(meta: Record<string, unknown>, msg: string): void;
  },
): orchestrator.GapDetectorPort {
  return {
    async recordUnwiredOrganGap(input): Promise<void> {
      const scope = input.ctx.scope;
      // Only a tenant-scoped miss can own a durable, RLS-isolated gap row. A
      // platform-scope miss has no tenant to key on — skip (honest no-op) rather
      // than invent a tenant. Fail-safe: never throw back into the dispatcher.
      if (scope.kind !== 'tenant') return;
      const competenceDomain = competenceDomainFromTool(input.toolName);
      const narrative = gapNarrative(input.toolName, input.gapKind);
      const gap: MdCommitmentCreateGapInput = {
        tenantId: scope.tenantId,
        ownerId: scope.actorUserId,
        threadId: input.ctx.threadId,
        gapKind: input.gapKind,
        kind: input.toolName,
        title: narrative.title,
        titleSw: narrative.titleSw,
        rationale: narrative.rationale,
        // Evidence-required hard rule: the miss itself IS the evidence — a stable
        // pointer the watcher resolves against the live capability snapshot.
        evidenceIds: [`gap:${input.toolName}`],
        // The EXACT input that flips the gap to confident: the missing tool
        // registering (Kadavath inject-context). The blocker IS the tool name.
        unblockTrigger: { kind: 'tool_registered', target: input.toolName },
        ...(competenceDomain !== null ? { competenceDomain } : {}),
        // Sovereign flag pre-classified by the dispatcher via the SAME policy-gate
        // rail (isSovereignGapSource) — a sovereign-born gap parks HITL forever.
        sovereign: input.sovereign,
        // Stable per-(tool, kind) key so a tool that misses every tick files
        // exactly ONE gap row (createGap is idempotent on tenant + key).
        idempotencyKey: idemKeyFrom([
          'gap',
          input.gapKind,
          input.toolName,
        ]).replace(/^defer:/, 'gap:'),
      };
      try {
        await repo.createGap(gap);
      } catch (err) {
        // Best-effort: the gap write is the forensic mirror, never load-bearing.
        // Swallow + log so the dispatcher's tool_error is returned unchanged.
        logger?.warn(
          {
            wiring: 'md-gap-detector',
            toolName: input.toolName,
            gapKind: input.gapKind,
            reason: err instanceof Error ? err.message : 'createGap failed',
          },
          'md-gap-detector: createGap best-effort write failed',
        );
      }
    },
  };
}

/**
 * Composition-friendly variant: a `GapDetectorPort` that resolves the durable
 * repository LAZILY (at first miss) from the SAME singleton `configureMdDeferTools`
 * wired. This lets the dispatcher wiring (`brain-kernel-wiring.ts`) bind the live
 * gap seam in ONE line — `gapDetector: buildConfiguredMdGapDetector(logger)` —
 * with no repo re-threading, and the boot order (configure → dispatcher build)
 * never matters because the repo is read on the first detection, not at
 * construction. When the repo was never configured (degraded boot), the miss is
 * a fail-safe no-op (logged) — it NEVER throws back into the dispatcher.
 */
export function buildConfiguredMdGapDetector(logger?: {
  warn(meta: Record<string, unknown>, msg: string): void;
}): orchestrator.GapDetectorPort {
  return {
    async recordUnwiredOrganGap(input): Promise<void> {
      let repo: MdCommitmentRepository;
      try {
        repo = requireRepo();
      } catch {
        // Degraded boot — defer tools never configured. Honest no-op (the gap
        // store is dark) rather than crash the dispatcher's detection seam.
        logger?.warn(
          { wiring: 'md-gap-detector', toolName: input.toolName },
          'md-gap-detector: repo not configured at composition time — gap not recorded',
        );
        return;
      }
      await createMdGapDetector(repo, logger).recordUnwiredOrganGap(input);
    },
  };
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
    // Read the prior state once so the timeline can record the from→to transition.
    const before = await repo.get(ctx.tenantId, input.id);
    if (input.blockedReason) {
      const blocked = await repo.block(ctx.tenantId, input.id, input.blockedReason);
      if (blocked) {
        await timelineSink()?.record({
          tenantId: ctx.tenantId,
          commitmentId: blocked.id,
          eventKind: 'blocked',
          previousStatus: before?.status ?? null,
          newStatus: 'blocked',
          evidenceIds: blocked.evidenceIds,
          actor: 'owner',
        });
      }
      return { commitment: blocked ? toView(blocked) : null };
    }
    if (input.status) {
      const next = await repo.transition(ctx.tenantId, input.id, {
        status: input.status,
      });
      // LIVING-MD timeline: a reopen (closure-never-forgetting — an unconfirmed
      // thread comes back, it never silently closes) is recorded append-only.
      if (next && input.status === 'reopened') {
        await timelineSink()?.record({
          tenantId: ctx.tenantId,
          commitmentId: next.id,
          eventKind: 'reopened',
          previousStatus: before?.status ?? null,
          newStatus: 'reopened',
          evidenceIds: next.evidenceIds,
          actor: 'owner',
        });
      }
      return { commitment: next ? toView(next) : null };
    }
    return { commitment: before ? toView(before) : null };
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
    // LIVING-MD timeline: a positive-proof closure is recorded IN LOCKSTEP with
    // the ledger transition (closure-by-confirmation, never by timeout). The
    // sink is best-effort — it never throws, so it cannot break the close.
    if (done) {
      await timelineSink()?.record({
        tenantId: ctx.tenantId,
        commitmentId: done.id,
        eventKind: 'confirmed',
        newStatus: 'done',
        proofKind: input.confirmationKind,
        evidenceIds: done.evidenceIds,
        actor: 'owner',
      });
    }
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
