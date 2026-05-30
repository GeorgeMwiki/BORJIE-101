/**
 * Auto-Populate — Service (public entry point).
 *
 * Single function `processChat(turnId, text, ctx)` orchestrates:
 *   1. Extract entities from the chat turn via the LLM.
 *   2. Collapse same-turn duplicates.
 *   3. Gate by confidence (auto-persist / confirm-needed / drop).
 *   4. Fetch known entities of the same kinds, run dedupe.
 *   5. Persist auto_persist entities to per-kind tables.
 *   6. Record every entity (including dropped) to the audit trail.
 *   7. Return the full `ExtractedEntity[]` for the MD core to consume.
 *
 * Note on "DecisionTrace":
 *   Each audit row IS a decision trace for the auto-populate decision.
 *   It captures: input span, gate decision, dedupe action, persist
 *   outcome, owner-confirmation state. Reversible by flipping
 *   owner_confirmation to 'reverted'.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { ALL_ENTITY_KINDS, type ExtractedEntity } from "./entity-types";
import {
  extractEntities,
  type ContextMessage,
  type ExtractorInput,
} from "./extractor";
import {
  collapseIntraTurnDuplicates,
  resolveEntity,
  type DedupeOptions,
  type KnownEntity,
} from "./dedupe";
import {
  gateBatch,
  renderConfirmPrompt,
  type GateOptions,
  type GatedEntity,
} from "./confidence-gate";
import { fetchKnownEntities, persistEntity } from "./persister";
import { recordAudit, type OwnerConfirmation } from "./audit-trail";

const log = createLogger("md.auto-populate.service");

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const contextSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  recentMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .max(40)
    .optional(),
  // Optional override hooks (e.g. for tests).
  extractorOverride: z
    .function()
    .args(z.custom<ExtractorInput>())
    .returns(z.unknown())
    .optional(),
  knownOverride: z.array(z.custom<KnownEntity>()).optional(),
  gateOptions: z
    .object({
      autoThreshold: z.number().min(0).max(1).optional(),
      confirmThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  dedupeOptions: z
    .object({
      levenshteinThreshold: z.number().min(0).max(1).optional(),
      jaccardThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /** Skip DB writes (used by tests). */
  dryRun: z.boolean().optional(),
});

export type ProcessChatContext = z.infer<typeof contextSchema>;

export interface ProcessChatResult {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly autoPersisted: ReadonlyArray<{
    readonly entity: ExtractedEntity;
    readonly rowId: string;
    readonly merged: boolean;
  }>;
  readonly confirmNeeded: ReadonlyArray<{
    readonly entity: ExtractedEntity;
    readonly prompt: string;
  }>;
  readonly dropped: ReadonlyArray<ExtractedEntity>;
  readonly auditIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process one chat turn end-to-end. Never throws — failures bubble up
 * via empty arrays + log lines so the MD's reply pipeline always
 * completes.
 */
export async function processChat(
  turnId: string,
  text: string,
  ctx: unknown,
): Promise<ProcessChatResult> {
  const safeTurnId = turnId.trim();
  if (!safeTurnId) {
    log.warn("processChat called with empty turnId");
    return emptyResult();
  }
  if (!text || !text.trim()) {
    return emptyResult();
  }

  const parsed = contextSchema.safeParse(ctx);
  if (!parsed.success) {
    log.error("invalid context", { issues: parsed.error.issues });
    return emptyResult();
  }
  const context = parsed.data;

  const extractor = context.extractorOverride
    ? (context.extractorOverride as (
        i: ExtractorInput,
      ) => Promise<{ readonly entities: ReadonlyArray<ExtractedEntity> }>)
    : extractEntities;

  const extractionResult = await extractor({
    text,
    recentMessages: context.recentMessages as
      | ReadonlyArray<ContextMessage>
      | undefined,
  });

  const rawEntities = extractionResult.entities;
  if (rawEntities.length === 0) {
    return emptyResult();
  }

  // 2. Collapse intra-turn duplicates.
  const collapsed = collapseIntraTurnDuplicates(
    rawEntities,
    context.dedupeOptions,
  );

  // 3. Gate by confidence.
  const { autoPersist, confirmNeeded, dropped } = gateBatch(
    collapsed,
    context.gateOptions as GateOptions | undefined,
  );

  // 4. Fetch known entities for the kinds we plan to persist.
  const kindsToFetch = Array.from(
    new Set(autoPersist.map((g) => g.entity.kind)),
  ).filter((k) => (ALL_ENTITY_KINDS as ReadonlyArray<string>).includes(k));

  const known: ReadonlyArray<KnownEntity> =
    context.knownOverride !== undefined
      ? context.knownOverride
      : context.dryRun
        ? []
        : await fetchKnownEntities(context.tenantId, kindsToFetch);

  // 5+6. Persist + audit per gated entity.
  const persistedRows: Array<{
    readonly entity: ExtractedEntity;
    readonly rowId: string;
    readonly merged: boolean;
  }> = [];
  const auditIds: string[] = [];

  // Auto-persist path.
  for (const gated of autoPersist) {
    const match = resolveEntity(
      gated.entity,
      known,
      context.dedupeOptions as DedupeOptions | undefined,
    );
    let rowId: string | null = null;
    let merged = false;
    let errorMessage: string | null = null;

    if (!context.dryRun) {
      const persistResult = await persistEntity(
        gated.entity,
        {
          tenantId: context.tenantId,
          userId: context.userId,
        },
        {
          matchedRowId: match.action === "merge" ? match.matchedId : null,
        },
      );

      if (persistResult.ok) {
        rowId = persistResult.rowId;
        merged = persistResult.merged || match.action === "merge";
      } else {
        errorMessage = persistResult.error;
      }
    } else {
      rowId = "dryrun";
      merged = match.action === "merge";
    }

    if (rowId) {
      persistedRows.push({ entity: gated.entity, rowId, merged });
    }

    if (!context.dryRun) {
      const auditId = await recordAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        turnId: safeTurnId,
        entity: gated.entity,
        gateDecision: gated.decision,
        dedupeAction: match.action,
        dedupeReason: match.reason,
        dedupeScore: match.score,
        persistedRowId: rowId,
        ownerConfirmation: rowId
          ? ("auto" as OwnerConfirmation)
          : ("rejected" as OwnerConfirmation),
        errorMessage,
      });
      if (auditId) auditIds.push(auditId);
    }
  }

  // Confirm-needed path: never persists; just records an audit row with
  // owner_confirmation = 'pending' so the audit-trail UI can show it.
  const confirmEntries: Array<{
    readonly entity: ExtractedEntity;
    readonly prompt: string;
  }> = [];
  for (const gated of confirmNeeded) {
    const prompt = renderConfirmPrompt(gated) ?? "";
    confirmEntries.push({ entity: gated.entity, prompt });

    if (!context.dryRun) {
      const auditId = await recordAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        turnId: safeTurnId,
        entity: gated.entity,
        gateDecision: gated.decision,
        dedupeAction: null,
        dedupeReason: "below auto threshold — pending owner confirmation",
        dedupeScore: 0,
        persistedRowId: null,
        ownerConfirmation: "pending",
        errorMessage: null,
      });
      if (auditId) auditIds.push(auditId);
    }
  }

  // Dropped path: record in audit too, so the owner can review.
  for (const gated of dropped) {
    if (!context.dryRun) {
      const auditId = await recordAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        turnId: safeTurnId,
        entity: gated.entity,
        gateDecision: gated.decision,
        dedupeAction: null,
        dedupeReason: "below confirm threshold — dropped",
        dedupeScore: 0,
        persistedRowId: null,
        ownerConfirmation: "rejected",
        errorMessage: null,
      });
      if (auditId) auditIds.push(auditId);
    }
  }

  return {
    entities: collapsed,
    autoPersisted: persistedRows,
    confirmNeeded: confirmEntries,
    dropped: dropped.map((d: GatedEntity) => d.entity),
    auditIds,
  };
}

function emptyResult(): ProcessChatResult {
  return {
    entities: [],
    autoPersisted: [],
    confirmNeeded: [],
    dropped: [],
    auditIds: [],
  };
}
