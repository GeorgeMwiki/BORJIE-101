/**
 * Follow-up adapter — `FollowUpPersister` ➜ `MdFollowUpPort`.
 *
 * The orchestrator emits a "schedule one follow-up now" verb with a title +
 * dueAtMs. The underlying `FollowUpService.captureFromTurn` is the opposite
 * verb (extract commitments from raw chat text). So this adapter goes
 * directly to the persister with a pre-formed FollowUp row.
 *
 * Tier policy is asserted here — the same guard that captureFromTurn uses
 * internally — so the adapter never bypasses governance.
 *
 * @module features/central-command/md/composition/follow-up-adapter
 */

import { randomUUID } from "node:crypto";

import { requireTierPolicy } from "@/core/governance/tier-policy";
import type {
  MdFollowUpPort,
  MdFollowUpRequest,
  MdFollowUpRecord,
} from "@/features/central-command/md/core/contracts";
import type { FollowUp } from "@/features/central-command/md/follow-up/types";
import type { FollowUpPersister } from "@/features/central-command/md/follow-up/persister";

import type { RequestContext } from "./request-context";

export interface FollowUpAdapterDeps {
  readonly persister: FollowUpPersister;
  readonly ctx: RequestContext;
  readonly clock?: () => Date;
  readonly idGen?: () => string;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

function toRecord(fu: FollowUp): MdFollowUpRecord {
  return Object.freeze({
    followUpId: fu.id,
    orgId: fu.tenantId,
    ownerId: fu.ownerId,
    title: fu.subject,
    dueAtMs: Date.parse(fu.dueAt),
    sourceRef: fu.originTurnId,
    subjectKind: fu.counterparty ? "counterparty" : undefined,
    subjectId: fu.counterparty ?? undefined,
    createdAtMs: Date.parse(fu.createdAt),
  });
}

export function createFollowUpAdapter(
  deps: FollowUpAdapterDeps,
): MdFollowUpPort {
  const { persister, ctx, logger } = deps;
  const idGen = deps.idGen ?? randomUUID;
  const clock = deps.clock ?? (() => new Date());

  return Object.freeze({
    async schedule(req: MdFollowUpRequest): Promise<MdFollowUpRecord> {
      requireTierPolicy(ctx.tier, "md:schedule_follow_up");
      logger?.debug("followUp.schedule", {
        correlationId: ctx.correlationId,
        title: req.title,
        dueAtMs: req.dueAtMs,
      });

      const now = clock().toISOString();
      const fu: FollowUp = Object.freeze({
        id: idGen(),
        tenantId: req.orgId,
        ownerId: req.ownerId,
        subject: req.title,
        dueAt: new Date(req.dueAtMs).toISOString(),
        snoozedUntil: null,
        status: "pending" as const,
        originTurnId: req.sourceRef ?? ctx.correlationId,
        escalationLevel: 0 as const,
        priority: "normal" as const,
        createdAt: now,
        counterparty: req.subjectId ?? null,
        metadata: req.subjectKind
          ? { subjectKind: req.subjectKind }
          : undefined,
      });

      await persister.upsert(fu);
      return toRecord(fu);
    },

    async listDue(
      orgId: string,
      beforeMs: number,
    ): Promise<ReadonlyArray<MdFollowUpRecord>> {
      logger?.debug("followUp.listDue", {
        correlationId: ctx.correlationId,
        orgId,
        beforeMs,
      });
      const pending = await persister.listPending(orgId);
      const due = pending
        .filter((fu) => Date.parse(fu.dueAt) <= beforeMs)
        .map(toRecord);
      return Object.freeze(due);
    },
  });
}
