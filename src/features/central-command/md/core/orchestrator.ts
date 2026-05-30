/**
 * MD Core - Orchestrator
 *
 * The supervisor agent for the Managing Director surface. One call per
 * owner turn:
 *
 *   1. Fetch a tier-scoped business snapshot.
 *   2. Start a DecisionTrace.
 *   3. Read the owner's style profile.
 *   4. Ask NBA for ranked actions (low-hanging fruit + daily agenda).
 *   5. Emit MD events (observation -> assessment -> proposal -> follow-up).
 *   6. For act-with-approval / act-autonomous proposals, run governance gates.
 *   7. Refine owner-style based on this turn.
 *   8. Finalize the trace; return events + assistant text.
 *
 * No side-effecting writes happen in this file. Side-effects are delegated
 * to the auto-populate / follow-up ports and are tier-gated upstream.
 *
 * @module features/central-command/md/core/orchestrator
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import {
  assertTierPolicy,
  type BorjieAITier,
} from "@/core/governance/tier-policy";
import {
  decideLevel,
  type ActionStakes,
  type AutonomyDecision,
  type AutonomyLevel,
} from "@/core/brain/autonomy/levels";
import {
  startTrace,
  type DecisionAction,
  type TraceStore,
} from "@/core/borjie-ai/decision-trace";

import type { BusinessStateService } from "./business-state";
import type { MdSubagents, BusinessSnapshot, RankedAction } from "./contracts";
import {
  MdTurnInputSchema,
  type MdEvent,
  type MdObservation,
  type MdAssessment,
  type MdProposal,
  type MdAction,
  type MdFollowUp,
  type MdStyleUpdate,
  type MdTurnInput,
  type MdTurnResult,
  type MdCitation,
} from "./types";
import { buildMdSystemPrompt } from "./system-prompt";

const log = createLogger("md.core.orchestrator");

/**
 * Coerce an unknown caught value into a JSON-serialisable shape so the
 * structured logger can accept it. Borjie's `createLogger` expects a
 * `LogContext` (plain object), unlike Kaboni's which auto-normalises.
 */
function errorToLogValue(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = 3;
const FOLLOW_UP_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MdOrchestratorOptions {
  readonly topK?: number;
  readonly clock?: () => number;
  readonly traceModel?: string;
  readonly traceModelTier?: "haiku" | "sonnet" | "opus" | "external";
  readonly orgName?: string;
  readonly ownerName?: string;
  readonly businessTagline?: string;
}

export interface MdOrchestratorDeps {
  readonly businessState: BusinessStateService;
  readonly subagents: MdSubagents;
  readonly traceStore: TraceStore;
}

// ---------------------------------------------------------------------------
// Tier-action mapper for the runMdTurn entry-point
// ---------------------------------------------------------------------------

function turnTierAction(tier: BorjieAITier): "chat:converse" {
  // The MD chat surface is always a `chat:converse` action regardless of tier;
  // tier-specific reads happen in business-state.
  void tier;
  return "chat:converse";
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

function priorityRationale(action: RankedAction): string {
  return `${action.eisenhower.quadrant} | ICE=${action.ice.ice.toFixed(1)} | RICE=${action.rice.rice.toFixed(1)} | WSJF=${action.wsjf.wsjf.toFixed(1)}`;
}

function priorityScore(action: RankedAction): number {
  // Compose into a 0..1000 band so the protocol caps it.
  return Math.min(1000, Math.max(0, action.compositeScore));
}

function citationsForAction(
  action: RankedAction,
  snapshot: BusinessSnapshot,
): ReadonlyArray<MdCitation> {
  const cits: MdCitation[] = [];
  if (action.subjectRef && action.domain === "finance") {
    cits.push({
      field: "finance.cashUsd",
      valueSummary: `cash $${snapshot.finance.cashUsd.toLocaleString()}`,
    });
  }
  if (action.domain === "customer-success") {
    cits.push({
      field: "customers.length",
      valueSummary: `${snapshot.customers.length} active customers`,
    });
  }
  if (action.domain === "hr") {
    cits.push({
      field: "employees.length",
      valueSummary: `${snapshot.employees.length} employees`,
    });
  }
  if (action.domain === "sales") {
    cits.push({
      field: "pipeline.length",
      valueSummary: `${snapshot.pipeline.length} live deals`,
    });
  }
  return Object.freeze(cits);
}

function stakesFromAction(action: RankedAction): ActionStakes {
  // Conservative mapping: customer-facing or finance are at least medium.
  if (action.domain === "finance" || action.domain === "compliance") {
    return "medium";
  }
  if (action.domain === "customer-success" || action.domain === "sales") {
    return "low";
  }
  return "low";
}

function autonomyDecisionFor(
  action: RankedAction,
  tier: BorjieAITier,
): AutonomyDecision {
  // Risk score derives from inverse-confidence; high uncertainty pulls the
  // proposal back down the ladder.
  const riskScore = Math.max(0, Math.min(1, 1 - action.ice.confidence));
  return decideLevel({
    taskName: `nba:${action.templateId}`,
    riskScore,
    tenantContext: { tier },
    stakes: stakesFromAction(action),
    trackRecord: { known: true, driftFlagged: false },
    proposedAction: {
      skill: "md.proposal",
      verb: action.title,
      params: { templateId: action.templateId },
      target: action.subjectRef,
    },
  });
}

// ---------------------------------------------------------------------------
// Event factories (pure)
// ---------------------------------------------------------------------------

function makeObservation(args: {
  ts: number;
  severity: MdObservation["severity"];
  summary: string;
  citations: ReadonlyArray<MdCitation>;
}): MdObservation {
  return Object.freeze({
    kind: "md.observation",
    eventId: randomUUID(),
    ts: args.ts,
    severity: args.severity,
    summary: args.summary,
    citations: Object.freeze([...args.citations]),
  });
}

function makeAssessment(args: {
  ts: number;
  framework: MdAssessment["framework"];
  summary: string;
  score?: number;
  citations: ReadonlyArray<MdCitation>;
}): MdAssessment {
  return Object.freeze({
    kind: "md.assessment",
    eventId: randomUUID(),
    ts: args.ts,
    framework: args.framework,
    summary: args.summary,
    score: args.score,
    citations: Object.freeze([...args.citations]),
  });
}

function makeProposalFromAction(args: {
  ts: number;
  action: RankedAction;
  snapshot: BusinessSnapshot;
  autonomy: AutonomyDecision;
}): MdProposal {
  const requiresApproval = args.autonomy.level === "act-with-approval";
  const frozen = Object.freeze({
    kind: "md.proposal" as const,
    eventId: randomUUID(),
    ts: args.ts,
    proposalId: `${args.action.templateId}:${randomUUID()}`,
    title: args.action.title,
    rationale: `${args.action.rationale} | ${priorityRationale(args.action)}`,
    autonomyLevel: args.autonomy.level,
    requiresApproval,
    priorityScore: priorityScore(args.action),
    framework: "ICE" as const,
    citations: citationsForAction(args.action, args.snapshot),
    subjectRef: args.action.subjectRef
      ? { kind: "other" as const, id: args.action.subjectRef }
      : undefined,
  });
  return frozen as unknown as MdProposal;
}

function makeFollowUp(args: {
  ts: number;
  title: string;
  dueAtMs: number;
  sourceRef?: string;
}): MdFollowUp {
  return Object.freeze({
    kind: "md.follow-up",
    eventId: randomUUID(),
    ts: args.ts,
    followUpId: randomUUID(),
    title: args.title,
    dueAtMs: args.dueAtMs,
    sourceRef: args.sourceRef,
  });
}

function makeStyleUpdate(args: {
  ts: number;
  note: string;
  posture: MdStyleUpdate["posture"];
  confidence: number;
}): MdStyleUpdate {
  return Object.freeze({
    kind: "md.style-update",
    eventId: randomUUID(),
    ts: args.ts,
    note: args.note,
    posture: args.posture,
    confidence: args.confidence,
  });
}

function makeAction(args: {
  ts: number;
  action: RankedAction;
  autonomy: AutonomyDecision;
  traceId: string;
  approvalId: string | null;
}): MdAction {
  return Object.freeze({
    kind: "md.action" as const,
    eventId: randomUUID(),
    ts: args.ts,
    actionId: `${args.action.templateId}:${randomUUID()}`,
    traceId: args.traceId,
    autonomyLevel: args.autonomy.level,
    approvalId: args.approvalId,
    title: args.action.title,
    summary: args.action.rationale,
    status: "queued" as const,
    subjectRef: args.action.subjectRef
      ? { kind: "other" as const, id: args.action.subjectRef }
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// Assistant text composer
// ---------------------------------------------------------------------------

function composeAssistantText(args: {
  topAction: RankedAction | null;
  agendaCount: number;
  snapshot: BusinessSnapshot;
}): string {
  const lines: string[] = [];
  if (args.topAction) {
    lines.push(
      `Recommended next move: ${args.topAction.title}. ${args.topAction.rationale}`,
    );
    lines.push(`Why now: ${priorityRationale(args.topAction)}.`);
  } else {
    lines.push(
      "No high-priority move surfaced from the snapshot. The business looks steady today.",
    );
  }
  if (args.agendaCount > 0) {
    lines.push(
      `Daily agenda prepared: ${args.agendaCount} items ordered by Eisenhower urgency.`,
    );
  }
  const cashLine = `Cash position: $${args.snapshot.finance.cashUsd.toLocaleString()} with $${args.snapshot.finance.monthlyBurnUsd.toLocaleString()}/mo burn.`;
  lines.push(cashLine);
  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Main turn loop
// ---------------------------------------------------------------------------

export class MdOrchestrator {
  private readonly clock: () => number;
  private readonly topK: number;
  private readonly traceModel: string;
  private readonly traceModelTier: "haiku" | "sonnet" | "opus" | "external";
  private readonly orgName: string;
  private readonly ownerName?: string;
  private readonly businessTagline?: string;

  constructor(
    private readonly deps: MdOrchestratorDeps,
    options: MdOrchestratorOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.topK = options.topK ?? DEFAULT_TOP_K;
    this.traceModel = options.traceModel ?? "md-orchestrator";
    this.traceModelTier = options.traceModelTier ?? "sonnet";
    this.orgName = options.orgName ?? "the business";
    this.ownerName = options.ownerName;
    this.businessTagline = options.businessTagline;
  }

  async runTurn(rawInput: MdTurnInput | unknown): Promise<MdTurnResult> {
    const input = MdTurnInputSchema.parse(rawInput);

    // Tier gate at the entry point. business-state runs its own read check.
    const action = turnTierAction(input.tier);
    const tierResult = assertTierPolicy(input.tier, action);
    if (!tierResult.ok) {
      throw new Error(
        `md.orchestrator: tier '${input.tier}' may not '${action}' (${tierResult.reason})`,
      );
    }

    const recorder = startTrace({
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      userId: input.ownerId,
      tier: input.tier,
      model: this.traceModel,
      modelTier: this.traceModelTier,
      input: {
        text: input.text,
        portalId: input.portalId,
        route: input.route,
      },
      clock: this.clock,
    });

    recorder.addReasoning("md.orchestrator.turn.start", 0);

    // 0. Presenter pre-check: if the owner's text is an inline-data
    // request, the presenter returns a typed gen-UI spec we can
    // attach to the assistant_text envelope. Failures + no-match
    // both yield `null` and the normal turn proceeds.
    let presenterSpec: Readonly<Record<string, unknown>> | null = null;
    try {
      const presenterResult = await this.deps.subagents.presenter.process({
        text: input.text,
        userId: input.ownerId,
        tenantId: input.orgId,
        tier: input.tier,
        correlationId: input.correlationId,
        sessionId: input.sessionId,
      });
      if (presenterResult) {
        presenterSpec = presenterResult.spec;
        recorder.useTool({
          name: "presenter.process",
          input: {
            subject: presenterResult.subject,
            kind: presenterResult.kind,
          },
          output: { traceId: presenterResult.traceId },
          latencyMs: 0,
        });
      }
    } catch (err) {
      log.warn("presenter.process.failed", { error: errorToLogValue(err) });
    }

    // 1. Snapshot
    const snapshot = await this.deps.businessState.getSnapshot(
      input.orgId,
      input.tier,
    );
    recorder.addReasoning("md.orchestrator.snapshot.loaded");

    // 1b. Employees: fetch the active-employee sentiment aggregate so
    // observations can flag negative-sentiment or overdue 1-on-1
    // risks. Degrades to [] when the reader is unconfigured.
    let employeeSignals: ReadonlyArray<{
      employeeId: string;
      name: string;
      recentSentiment: string;
      daysSinceLastOneOnOne: number;
      riskScore: number;
    }> = [];
    try {
      employeeSignals = await this.deps.subagents.employees.read(input.orgId);
      recorder.considerTool("employees.read", 0.6);
    } catch (err) {
      log.warn("employees.read.failed", { error: errorToLogValue(err) });
    }

    // 2. Owner style
    const profile = await this.deps.subagents.ownerStyle.getProfile(
      input.ownerId,
    );
    recorder.considerTool("owner-style.getProfile", 1);

    // 3. NBA: top-K and agenda
    const ranked = await this.deps.subagents.nba.rankActions(
      snapshot,
      this.topK,
    );
    recorder.considerTool("nba.rankActions", 1);
    const agenda = await this.deps.subagents.nba.getDailyAgenda(snapshot);
    recorder.considerTool("nba.getDailyAgenda", 0.9);

    // 3b. Auto-populate: mine the owner's text for fresh employees /
    // customers / leads / suppliers / KPIs. Tier gate enforced inside
    // the adapter; failures degrade silently (the rest of the turn
    // still has the snapshot to reason on).
    let populated: ReadonlyArray<{
      readonly kind: string;
      readonly confidence: number;
    }> = [];
    try {
      const apResult = await this.deps.subagents.autoPopulate.populate({
        orgId: input.orgId,
        hint: input.text,
        target: "any",
        tier: input.tier,
      });
      if (apResult.ok && apResult.fields) {
        const entries = Object.entries(apResult.fields);
        populated = entries.map(([k, v]: [string, unknown]) =>
          Object.freeze({
            kind: k,
            confidence:
              typeof (v as { confidence?: number })?.confidence === "number"
                ? (v as { confidence: number }).confidence
                : 0.5,
          }),
        );
      }
      recorder.useTool({
        name: "auto-populate.populate",
        input: {
          target: "any",
          hintLength: input.text.length,
        },
        output: {
          ok: apResult.ok,
          fields: populated.length,
          gaps: apResult.gaps?.length ?? 0,
        },
        latencyMs: 0,
      });
    } catch (err) {
      log.warn("auto-populate.populate.failed", {
        error: errorToLogValue(err),
      });
    }

    // 4. Assemble events
    const now = this.clock();
    const events: MdEvent[] = [];

    // Observation: cash + agenda counts
    events.push(
      makeObservation({
        ts: now,
        severity:
          snapshot.finance.cashUsd <= snapshot.finance.monthlyBurnUsd * 3
            ? "concern"
            : "info",
        summary: `Cash $${snapshot.finance.cashUsd.toLocaleString()}; burn $${snapshot.finance.monthlyBurnUsd.toLocaleString()}/mo; ${agenda.length} agenda items.`,
        citations: Object.freeze([
          {
            field: "finance.cashUsd",
            valueSummary: `$${snapshot.finance.cashUsd.toLocaleString()}`,
          },
          {
            field: "finance.monthlyBurnUsd",
            valueSummary: `$${snapshot.finance.monthlyBurnUsd.toLocaleString()}`,
          },
        ]),
      }),
    );

    // Assessment: framework summary for the top action.
    const topAction = ranked[0] ?? null;
    if (topAction) {
      events.push(
        makeAssessment({
          ts: now,
          framework: "ICE",
          summary: `Top move scored ICE=${topAction.ice.ice.toFixed(1)} (impact ${topAction.ice.impact}, confidence ${topAction.ice.confidence.toFixed(2)}, ease ${topAction.ice.ease}).`,
          score: Math.min(100, topAction.ice.ice * 10),
          citations: citationsForAction(topAction, snapshot),
        }),
      );
    }

    // Auto-populate observation: if the owner's turn mentioned any
    // employees/customers/leads/etc, surface a single rollup so the
    // owner sees what the brain captured without leaving chat.
    if (populated.length > 0) {
      events.push(
        makeObservation({
          ts: now,
          severity: "info",
          summary: `Captured ${populated.length} entit${populated.length === 1 ? "y" : "ies"} from your message (${populated.map((p) => p.kind).join(", ")}). Filed for you.`,
          citations: Object.freeze([]),
        }),
      );
    }

    // Employee observation: pick the highest-risk employee signal +
    // surface as a concern. Caps at one observation per turn to keep
    // the chat readable.
    if (employeeSignals.length > 0) {
      const ranked = [...employeeSignals].sort(
        (a, b) => b.riskScore - a.riskScore,
      );
      const top = ranked[0];
      if (top && top.riskScore >= 0.5) {
        events.push(
          makeObservation({
            ts: now,
            severity: top.riskScore >= 0.75 ? "urgent" : "concern",
            summary: `${top.name}: ${top.recentSentiment} sentiment, ${top.daysSinceLastOneOnOne}d since 1-on-1.`,
            citations: Object.freeze([
              {
                field: "employees.riskScore",
                valueSummary: `${top.name} risk=${top.riskScore.toFixed(2)}`,
              },
            ]),
          }),
        );
      }
    }

    // Proposals: one per ranked action. For act-autonomous proposals,
    // also emit a paired md.action event so the chain
    // observation -> assessment -> proposal -> action -> follow-up
    // is complete and the chat surface can render an approval row.
    for (const a of ranked) {
      const autonomy = autonomyDecisionFor(a, input.tier);
      events.push(
        makeProposalFromAction({
          ts: now,
          action: a,
          snapshot,
          autonomy,
        }),
      );
      recorder.addReasoning(
        `md.proposal.${a.templateId} -> ${autonomy.level} (${autonomy.reason})`,
      );

      // Emit a queued action only when the autonomy ladder allows the
      // brain to act without a fresh four-eye approval. Even then, the
      // action stays "queued" (not "running") — the route handler /
      // operator UI is the only thing that can flip it to running,
      // and act-with-approval proposals remain terminal at the
      // proposal node (no md.action) until an approval lands.
      if (autonomy.level === "act-autonomous") {
        events.push(
          makeAction({
            ts: now,
            action: a,
            autonomy,
            traceId: recorder.id,
            approvalId: null,
          }),
        );
      }
    }

    // Follow-up: for the top action, set a 7-day reminder. The follow-up
    // subagent persists; we mirror an MdFollowUp into the event stream.
    if (topAction) {
      const dueAtMs = now + 7 * MS_PER_DAY;
      try {
        const record = await this.deps.subagents.followUp.schedule({
          orgId: input.orgId,
          ownerId: input.ownerId,
          title: `Check-in: ${topAction.title}`,
          dueAtMs,
          sourceRef: topAction.templateId,
          subjectKind: "task",
          subjectId: topAction.subjectRef,
        });
        events.push(
          makeFollowUp({
            ts: now,
            title: record.title,
            dueAtMs: record.dueAtMs,
            sourceRef: record.sourceRef,
          }),
        );
        recorder.useTool({
          name: "follow-up.schedule",
          input: { title: record.title, dueAtMs: record.dueAtMs },
          output: { followUpId: record.followUpId },
          latencyMs: 0,
        });
      } catch (err) {
        log.warn("follow-up.schedule.failed", { error: errorToLogValue(err) });
      }
    }

    // Style update: refine then emit.
    try {
      const refined = await this.deps.subagents.ownerStyle.refine(
        input.ownerId,
        [{ text: input.text, tsMs: now }],
      );
      events.push(
        makeStyleUpdate({
          ts: now,
          note: refined.changeNote,
          posture: refined.profile.posture,
          confidence: refined.profile.confidence,
        }),
      );
      recorder.useTool({
        name: "owner-style.refine",
        input: { ownerId: input.ownerId },
        output: { posture: refined.profile.posture },
        latencyMs: 0,
      });
    } catch (err) {
      log.warn("owner-style.refine.failed", { error: errorToLogValue(err) });
    }

    // 4b. Timeline: if there are 2+ ranked actions, build a CPM
    // schedule + emit a low-noise observation summarising the path.
    // The adapter's safe-default sequential fallback runs when no
    // generator is wired, so this always produces something useful.
    if (ranked.length >= 2) {
      try {
        const milestones = await this.deps.subagents.timeline.build({
          orgId: input.orgId,
          startMs: now,
          actions: ranked.map((r, i) => ({
            id: r.templateId,
            title: r.title,
            effortPersonDays: Math.max(1, Math.round(r.rice.effortPersonDays)),
            dependsOn: i === 0 ? undefined : [ranked[i - 1].templateId],
          })),
        });
        if (milestones.length > 0) {
          const totalDays = Math.max(
            0,
            Math.round(
              (milestones[milestones.length - 1].endMs - now) / MS_PER_DAY,
            ),
          );
          const critical = milestones.filter((m) => m.onCriticalPath).length;
          events.push(
            makeObservation({
              ts: now,
              severity: "info",
              summary: `Timeline: ${milestones.length} milestones, ~${totalDays}d total, ${critical} on the critical path.`,
              citations: Object.freeze([]),
            }),
          );
          recorder.useTool({
            name: "timeline.build",
            input: { actions: ranked.length },
            output: { milestones: milestones.length, totalDays },
            latencyMs: 0,
          });
        }
      } catch (err) {
        log.warn("timeline.build.failed", { error: errorToLogValue(err) });
      }
    }

    // 5. Assistant text + finalize. If the presenter produced an
    // inline-data spec, prepend a single line that signals the chat
    // surface to render the gen-UI block inline rather than treating
    // the response as plain text.
    const composedText = composeAssistantText({
      topAction,
      agendaCount: agenda.length,
      snapshot,
    });
    const assistantText = presenterSpec
      ? `Showing the inline data you asked for.\n\n${composedText}`
      : composedText;

    const finalAction: DecisionAction = {
      type: "md.turn.completed",
      target: input.orgId,
      payload: {
        proposals: ranked.map((r) => r.templateId),
        agendaCount: agenda.length,
        followUpWindowDays: FOLLOW_UP_WINDOW_DAYS,
        presenterSpec: presenterSpec ? "inline" : "none",
        employeeSignals: employeeSignals.length,
      },
    };

    const trace = await recorder.finalize(finalAction, this.deps.traceStore);

    void profile; // Captured for traceability; future style-aware tuning.

    return Object.freeze({
      traceId: trace.id,
      events: Object.freeze(events),
      assistantText,
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience: a fresh orchestrator + system prompt for one shot
// ---------------------------------------------------------------------------

export function renderMdSystemPromptForTurn(args: {
  readonly orgName: string;
  readonly tier: BorjieAITier;
  readonly ownerName?: string;
  readonly businessTagline?: string;
  readonly posture?:
    | "bias-to-action"
    | "deliberate"
    | "data-driven"
    | "people-first";
  readonly jurisdiction?: {
    readonly code: string;
    readonly name: string;
    readonly currency: string;
    readonly aprCap: number | null;
    readonly regulators?: ReadonlyArray<string>;
  };
}): string {
  return buildMdSystemPrompt({
    orgName: args.orgName,
    ownerName: args.ownerName,
    tier: args.tier,
    businessTagline: args.businessTagline,
    ownerPosture: args.posture,
    jurisdiction: args.jurisdiction,
  });
}

/**
 * iter-39: pull jurisdiction directly off `MdTurnInput` so the chat
 * route + downstream subagents have a single source of truth for the
 * per-turn system prompt. The chat route resolves the org's
 * jurisdiction via `org-jurisdiction-service`, stuffs it onto
 * `turnInput.jurisdiction`, and this helper renders the fully-baked
 * prompt the LLM consumes.
 */
export function renderMdSystemPromptFromTurn(args: {
  readonly turn: MdTurnInput;
  readonly orgName: string;
  readonly ownerName?: string;
  readonly businessTagline?: string;
  readonly posture?:
    | "bias-to-action"
    | "deliberate"
    | "data-driven"
    | "people-first";
}): string {
  return buildMdSystemPrompt({
    orgName: args.orgName,
    ownerName: args.ownerName,
    tier: args.turn.tier,
    businessTagline: args.businessTagline,
    ownerPosture: args.posture,
    jurisdiction: args.turn.jurisdiction,
  });
}

// Re-export AutonomyLevel for downstream consumers that only import md/core.
export type { AutonomyLevel };
