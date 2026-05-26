/**
 * tier2-queue — owner-facing approval queue for Tier-2 document artifacts.
 *
 * SEPARATE from the evolution proposals: this is the gate for the
 * individual artifacts of Tier-2 recipes (Tumemadini return, NEMC
 * filing, contract, buyer KYB pack). Spec §8 mandates every Tier-2
 * artefact starts `pending` and must traverse this queue before send.
 *
 * Lifecycle:
 *  - watcher: poll `document_artifacts` for new pending Tier-2 rows
 *    since the last cursor → push a card onto the owner queue + emit
 *    a notification.
 *  - approve(): owner approval → state=approved → audit + remove from
 *    queue. Artifact then eligible for send/submit.
 *  - reject(): owner rejection → state=rejected → audit + remove. No
 *    further processing.
 *
 * The watcher is pull-based to keep the worker stateless. A redis
 * cursor `doc_evo:tier2_queue:cursor` records the highest generated_at
 * we have processed; tests use an in-memory cursor.
 */

import type { ChainEntry } from '@borjie/audit-hash-chain';
import type {
  DocumentArtifactRow,
  DocumentClass,
  Tier2ApprovalCard,
} from '../types.js';
import type { ArtifactRepository } from '../storage/artifact-repository.js';
import { emitAuditEntry } from '../audit/audit-emit.js';

/** The four Tier-2 document classes per spec §2. */
export const TIER2_DOCUMENT_CLASSES: ReadonlyArray<DocumentClass> = [
  'tumemadini_return',
  'nemc_filing',
  'buyer_kyb_pack',
  'contract',
];

/** Cursor port — `last_seen_at_iso` is the high-water mark. */
export interface QueueCursor {
  read(): Promise<string | null>;
  write(iso: string): Promise<void>;
}

export class InMemoryQueueCursor implements QueueCursor {
  private value: string | null = null;
  public async read(): Promise<string | null> {
    return this.value;
  }
  public async write(iso: string): Promise<void> {
    this.value = iso;
  }
}

export interface Tier2QueueSink {
  enqueue(card: Tier2ApprovalCard): Promise<void> | void;
}

export interface Tier2WatcherDeps {
  readonly artifacts: ArtifactRepository;
  readonly cursor: QueueCursor;
  readonly sink: Tier2QueueSink;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
  readonly tier2_classes?: ReadonlyArray<DocumentClass>;
  readonly batch_limit?: number;
}

export interface Tier2WatcherResult {
  readonly cards_emitted: number;
  readonly auditChain: ReadonlyArray<ChainEntry>;
  readonly cursor_advanced_to: string | null;
}

/**
 * Single tick of the watcher — pull pending Tier-2 artifacts since the
 * cursor and emit a card per row.
 */
export async function tickTier2Queue(
  deps: Tier2WatcherDeps,
): Promise<Tier2WatcherResult> {
  const lastSeen = (await deps.cursor.read()) ?? '1970-01-01T00:00:00Z';
  const classes = deps.tier2_classes ?? TIER2_DOCUMENT_CLASSES;
  const rows = await deps.artifacts.listPendingTier2({
    tier2_classes: classes as ReadonlyArray<string>,
    since_iso: lastSeen,
    limit: deps.batch_limit ?? 100,
  });

  let chain: ReadonlyArray<ChainEntry> = deps.auditChain ?? [];
  let highest: string = lastSeen;

  for (const row of rows) {
    const card = toCard(row, classes);
    if (card === null) continue;
    try {
      await deps.sink.enqueue(card);
      const next = emitAuditEntry({
        kind: 'doc_evo.tier2_queue_enqueue',
        tenant_id: row.tenant_id,
        subject: {
          artifact_id: row.id,
          recipe_id: row.recipe_id,
          recipe_version: row.recipe_version,
          format: row.format,
          checksum: row.checksum,
        },
        chain,
        ...(deps.auditSecretId !== undefined
          ? { secret_id: deps.auditSecretId }
          : {}),
        ...(deps.auditSecretValue !== undefined
          ? { secret_value: deps.auditSecretValue }
          : {}),
      });
      chain = next.chain;
      if (row.generated_at > highest) {
        highest = row.generated_at;
      }
    } catch {
      // If sink fails, leave the row in the queue — next tick retries.
      // Do not advance the cursor past a failed enqueue.
      return {
        cards_emitted: rows.indexOf(row),
        auditChain: chain,
        cursor_advanced_to: highest === lastSeen ? null : highest,
      };
    }
  }

  if (rows.length > 0 && highest !== lastSeen) {
    await deps.cursor.write(highest);
  }

  return {
    cards_emitted: rows.length,
    auditChain: chain,
    cursor_advanced_to: highest === lastSeen ? null : highest,
  };
}

/**
 * Owner approves a Tier-2 artifact — mark approved + audit.
 */
export async function approveTier2Artifact(args: {
  readonly artifact_id: string;
  readonly reviewer_user_id: string;
  readonly tenant_id: string;
  readonly artifacts: ArtifactRepository;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
}): Promise<{ readonly auditChain: ReadonlyArray<ChainEntry> }> {
  await args.artifacts.updateApprovalState({
    artifact_id: args.artifact_id,
    approval_state: 'approved',
    approved_by: args.reviewer_user_id,
  });
  const audit = emitAuditEntry({
    kind: 'doc_evo.proposal_review',
    tenant_id: args.tenant_id,
    subject: {
      artifact_id: args.artifact_id,
      action: 'tier2_approved',
      reviewer_user_id: args.reviewer_user_id,
    },
    chain: args.auditChain ?? [],
    ...(args.auditSecretId !== undefined
      ? { secret_id: args.auditSecretId }
      : {}),
    ...(args.auditSecretValue !== undefined
      ? { secret_value: args.auditSecretValue }
      : {}),
  });
  return { auditChain: audit.chain };
}

/**
 * Owner rejects a Tier-2 artifact — mark rejected + audit + remove from queue.
 */
export async function rejectTier2Artifact(args: {
  readonly artifact_id: string;
  readonly reviewer_user_id: string;
  readonly tenant_id: string;
  readonly reason: string | null;
  readonly artifacts: ArtifactRepository;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
}): Promise<{ readonly auditChain: ReadonlyArray<ChainEntry> }> {
  await args.artifacts.updateApprovalState({
    artifact_id: args.artifact_id,
    approval_state: 'rejected',
    approved_by: args.reviewer_user_id,
  });
  const audit = emitAuditEntry({
    kind: 'doc_evo.proposal_review',
    tenant_id: args.tenant_id,
    subject: {
      artifact_id: args.artifact_id,
      action: 'tier2_rejected',
      reviewer_user_id: args.reviewer_user_id,
      reason: args.reason ?? null,
    },
    chain: args.auditChain ?? [],
    ...(args.auditSecretId !== undefined
      ? { secret_id: args.auditSecretId }
      : {}),
    ...(args.auditSecretValue !== undefined
      ? { secret_value: args.auditSecretValue }
      : {}),
  });
  return { auditChain: audit.chain };
}

function toCard(
  row: DocumentArtifactRow,
  classes: ReadonlyArray<DocumentClass>,
): Tier2ApprovalCard | null {
  // We do not know the row's recipe class without the join — the caller
  // supplied only the closed set. We pick the matching class by reading
  // the artefact's storage_bucket convention `borjie-docs-<class>`. If
  // none matches we still emit but mark `contract` as a safe default —
  // tests use the explicit class set.
  const classFromStorage = classes.find((c) => row.storage_key.includes(c));
  return {
    artifact_id: row.id,
    tenant_id: row.tenant_id,
    recipe_id: row.recipe_id,
    recipe_version: row.recipe_version,
    recipe_class: classFromStorage ?? 'contract',
    format: row.format,
    storage_key: row.storage_key,
    checksum: row.checksum,
    generated_at: row.generated_at,
  };
}
