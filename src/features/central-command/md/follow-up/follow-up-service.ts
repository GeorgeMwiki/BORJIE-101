/**
 * Follow-Up — Public Service API
 *
 * Composes the extractor, persister, scheduler, and tier-policy guards.
 * Every public method produces a `DecisionTrace` via the supplied
 * trace store. Tier-policy is enforced before any write.
 *
 * @module features/central-command/md/follow-up/follow-up-service
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { startTrace, type TraceStore } from "@/core/borjie-ai/decision-trace";
import {
  assertTierPolicy,
  type BorjieAITier,
} from "@/core/governance/tier-policy";
import { defaultExtractor } from "./extractor";
import { computeEscalation, applyEscalation } from "./escalation";
import { runFollowUpScheduler } from "./scheduler";
import type { FollowUpPersister } from "./persister";
import type {
  ExtractorFn,
  ExtractorInput,
  FollowUp,
  FollowUpStatus,
  SchedulerTickOutput,
} from "./types";

const log = createLogger("md.follow-up.service");

export interface FollowUpServiceDeps {
  readonly persister: FollowUpPersister;
  readonly traceStore: TraceStore;
  readonly extractor?: ExtractorFn;
  readonly idGen?: () => string;
  readonly clock?: () => Date;
}

export interface CaptureInput {
  readonly tier: BorjieAITier;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly turn: ExtractorInput;
}

export interface CaptureResult {
  readonly created: ReadonlyArray<FollowUp>;
  readonly traceId: string;
}

export interface TickInput {
  readonly tier: BorjieAITier;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly now: Date;
}

export interface FollowUpService {
  /** Extract commitments from a turn and persist them as follow-ups. */
  captureFromTurn(input: CaptureInput): Promise<CaptureResult>;
  /** Run a scheduler tick against persisted pending follow-ups. */
  tick(input: TickInput): Promise<SchedulerTickOutput>;
  /** Update lifecycle status (e.g. owner marks complete). */
  setStatus(
    tier: BorjieAITier,
    id: string,
    status: FollowUpStatus,
  ): Promise<void>;
}

export function makeFollowUpService(
  deps: FollowUpServiceDeps,
): FollowUpService {
  const extractor = deps.extractor ?? defaultExtractor;
  const idGen = deps.idGen ?? randomUUID;
  const clock = deps.clock ?? (() => new Date());

  return Object.freeze({
    async captureFromTurn(input: CaptureInput): Promise<CaptureResult> {
      assertWrite(input.tier);
      const recorder = startTrace({
        correlationId: input.correlationId,
        sessionId: input.sessionId,
        userId: input.userId,
        tier: input.tier,
        model: "md.follow-up.extractor",
        modelTier: "haiku",
        input: {
          text: input.turn.text,
          portalId: "central-command.md",
          route: "follow-up/capture",
        },
      });

      recorder.considerTool("commitment.extractor", 1.0);
      const start = Date.now();
      const commits = await extractor(input.turn);
      recorder.useTool({
        name: "commitment.extractor",
        input: { turnId: input.turn.turnId },
        output: { count: commits.length },
        latencyMs: Date.now() - start,
      });

      const now = clock().toISOString();
      const created: FollowUp[] = commits.map((c) =>
        Object.freeze({
          id: idGen(),
          tenantId: input.turn.tenantId,
          ownerId: input.turn.ownerId,
          subject: c.subject,
          dueAt: c.dueAt,
          snoozedUntil: null,
          status: "pending" as FollowUpStatus,
          originTurnId: input.turn.turnId,
          escalationLevel: 0 as const,
          priority: c.priority,
          createdAt: now,
          counterparty: input.turn.counterparty ?? null,
          metadata: { confidence: c.confidence, evidence: c.evidence },
        }),
      );

      if (created.length > 0) {
        recorder.addReasoning(
          `extracted ${created.length} commitment(s); persisting`,
        );
        await deps.persister.upsertMany(created);
      } else {
        recorder.addReasoning("no commitments detected in turn");
      }

      const trace = await recorder.finalize(
        {
          type: "md.follow-up.capture",
          target: input.turn.turnId,
          payload: { count: created.length },
        },
        deps.traceStore,
      );

      log.info("captureFromTurn done", {
        turnId: input.turn.turnId,
        created: created.length,
      });

      return Object.freeze({
        created: Object.freeze(created),
        traceId: trace.id,
      });
    },

    async tick(input: TickInput): Promise<SchedulerTickOutput> {
      const recorder = startTrace({
        correlationId: input.correlationId,
        sessionId: input.sessionId,
        userId: input.userId,
        tier: input.tier,
        model: "md.follow-up.scheduler",
        modelTier: "haiku",
        input: {
          text: `tick ${input.now.toISOString()}`,
          portalId: "central-command.md",
          route: "follow-up/tick",
        },
      });

      const pending = await deps.persister.listPending(input.tenantId);
      recorder.useTool({
        name: "persister.listPending",
        input: { tenantId: input.tenantId },
        output: { count: pending.length },
        latencyMs: 0,
      });

      const result = runFollowUpScheduler({ now: input.now, pending });

      // Apply transitions back to storage.
      const updates: FollowUp[] = [];
      for (const fu of result.becameDue) updates.push(fu);
      for (const fu of result.escalated) {
        const r = computeEscalation(fu, input.now);
        updates.push(applyEscalation(fu, r));
      }
      if (updates.length > 0) {
        await deps.persister.upsertMany(updates);
      }

      recorder.addReasoning(
        `becameDue=${result.becameDue.length} escalated=${result.escalated.length}`,
      );

      await recorder.finalize(
        {
          type: "md.follow-up.tick",
          payload: {
            becameDue: result.becameDue.length,
            escalated: result.escalated.length,
            stillSnoozed: result.stillSnoozed.length,
          },
        },
        deps.traceStore,
      );

      return result;
    },

    async setStatus(
      tier: BorjieAITier,
      id: string,
      status: FollowUpStatus,
    ): Promise<void> {
      assertWrite(tier);
      await deps.persister.setStatus(id, status);
    },
  });
}

function assertWrite(tier: BorjieAITier): void {
  const r = assertTierPolicy(tier, "chat:converse");
  if (!r.ok) {
    throw new Error(`md.follow-up: tier ${tier} forbidden (${r.reason})`);
  }
}
