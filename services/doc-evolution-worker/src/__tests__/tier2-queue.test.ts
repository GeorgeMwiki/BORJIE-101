/**
 * tier2-queue.test — the SEPARATE owner-approval queue for individual
 * Tier-2 artifacts.
 *
 * Spec §8: every Tier-2 doc artefact starts `pending`, the worker emits
 * a notification onto the owner-approval queue, and only an approve
 * transition lets the artefact proceed to send/submit.
 *
 * We verify:
 *   - The watcher pulls pending Tier-2 rows since the cursor.
 *   - It emits one card per row and advances the cursor.
 *   - approveTier2Artifact transitions state to `approved`.
 *   - rejectTier2Artifact transitions state to `rejected` and skips audit-of-approval.
 *   - A failing sink leaves the cursor un-advanced (so the next tick retries).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  tickTier2Queue,
  approveTier2Artifact,
  rejectTier2Artifact,
  InMemoryQueueCursor,
  TIER2_DOCUMENT_CLASSES,
  type Tier2QueueSink,
} from '../approval/tier2-queue.js';
import type {
  ArtifactRepository,
} from '../storage/artifact-repository.js';
import type {
  DocumentArtifactRow,
  ApprovalState,
  Tier2ApprovalCard,
} from '../types.js';

function makeRow(
  overrides: Partial<DocumentArtifactRow>,
): DocumentArtifactRow {
  return {
    id: overrides.id ?? 'art-1',
    tenant_id: overrides.tenant_id ?? 't1',
    recipe_id: overrides.recipe_id ?? 'tumemadini_monthly_return',
    recipe_version: overrides.recipe_version ?? 1,
    format: overrides.format ?? 'pdf',
    storage_key:
      overrides.storage_key ?? 'borjie-docs-tumemadini_return/2026/05/01.pdf',
    checksum: overrides.checksum ?? 'sha256:abc',
    span_citations: overrides.span_citations ?? [],
    audit_hash: overrides.audit_hash ?? 'hash:0',
    approval_state: overrides.approval_state ?? 'pending',
    approved_by: overrides.approved_by ?? null,
    approved_at: overrides.approved_at ?? null,
    generated_at: overrides.generated_at ?? '2026-05-01T10:00:00Z',
  };
}

function makeArtifactRepo(
  rows: ReadonlyArray<DocumentArtifactRow>,
  onUpdate?: (args: {
    artifact_id: string;
    approval_state: ApprovalState;
    approved_by: string | null;
  }) => void,
): ArtifactRepository {
  return {
    async countByRecipeWindow() {
      return rows.length;
    },
    async listPendingTier2(args) {
      return rows
        .filter((r) => r.approval_state === 'pending')
        .filter((r) => r.generated_at >= args.since_iso)
        .slice(0, args.limit);
    },
    async updateApprovalState(args) {
      onUpdate?.(args);
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

describe('tickTier2Queue', () => {
  it('emits one card per pending Tier-2 row and advances cursor', async () => {
    const rows = [
      makeRow({ id: 'art-1', generated_at: '2026-05-01T10:00:00Z' }),
      makeRow({ id: 'art-2', generated_at: '2026-05-01T11:00:00Z' }),
    ];
    const emitted: Tier2ApprovalCard[] = [];
    const sink: Tier2QueueSink = {
      enqueue(card) {
        emitted.push(card);
      },
    };
    const cursor = new InMemoryQueueCursor();
    const result = await tickTier2Queue({
      artifacts: makeArtifactRepo(rows),
      cursor,
      sink,
      tier2_classes: TIER2_DOCUMENT_CLASSES,
    });
    expect(result.cards_emitted).toBe(2);
    expect(emitted.map((c) => c.artifact_id)).toEqual(['art-1', 'art-2']);
    expect(emitted[0]!.recipe_class).toBe('tumemadini_return');
    expect(await cursor.read()).toBe('2026-05-01T11:00:00Z');
  });

  it('does not advance cursor when sink fails', async () => {
    const rows = [
      makeRow({ id: 'art-1', generated_at: '2026-05-01T10:00:00Z' }),
      makeRow({ id: 'art-2', generated_at: '2026-05-01T11:00:00Z' }),
    ];
    let count = 0;
    const sink: Tier2QueueSink = {
      enqueue() {
        count += 1;
        if (count === 2) throw new Error('sink down');
      },
    };
    const cursor = new InMemoryQueueCursor();
    const result = await tickTier2Queue({
      artifacts: makeArtifactRepo(rows),
      cursor,
      sink,
    });
    expect(result.cards_emitted).toBe(1);
    // First emit advanced highest to 10:00; sink failed before 11:00 was
    // committed; the cursor is left at the prior high-water mark — we
    // never write a value past a failed emit.
    expect(await cursor.read()).toBeNull();
  });

  it('skips rows older than or equal to the cursor', async () => {
    const cursor = new InMemoryQueueCursor();
    await cursor.write('2026-05-01T12:00:00Z');
    const rows = [
      makeRow({ id: 'art-old', generated_at: '2026-05-01T09:00:00Z' }),
      makeRow({ id: 'art-new', generated_at: '2026-05-01T14:00:00Z' }),
    ];
    const emitted: Tier2ApprovalCard[] = [];
    const result = await tickTier2Queue({
      artifacts: makeArtifactRepo(rows),
      cursor,
      sink: {
        enqueue(c) {
          emitted.push(c);
        },
      },
    });
    expect(result.cards_emitted).toBe(1);
    expect(emitted[0]!.artifact_id).toBe('art-new');
  });

  it('no-ops when there are no pending rows', async () => {
    const result = await tickTier2Queue({
      artifacts: makeArtifactRepo([]),
      cursor: new InMemoryQueueCursor(),
      sink: { enqueue: vi.fn() },
    });
    expect(result.cards_emitted).toBe(0);
    expect(result.cursor_advanced_to).toBeNull();
  });
});

describe('approve / reject Tier-2 artifact', () => {
  it('approve transitions state to approved and stamps approved_by', async () => {
    const updates: Array<{
      artifact_id: string;
      approval_state: ApprovalState;
      approved_by: string | null;
    }> = [];
    const repo = makeArtifactRepo(
      [makeRow({ id: 'art-1' })],
      (u) => updates.push(u),
    );
    await approveTier2Artifact({
      artifact_id: 'art-1',
      reviewer_user_id: 'owner-1',
      tenant_id: 't1',
      artifacts: repo,
    });
    expect(updates).toEqual([
      {
        artifact_id: 'art-1',
        approval_state: 'approved',
        approved_by: 'owner-1',
      },
    ]);
  });

  it('reject transitions state to rejected and records reviewer', async () => {
    const updates: Array<{
      artifact_id: string;
      approval_state: ApprovalState;
      approved_by: string | null;
    }> = [];
    const repo = makeArtifactRepo(
      [makeRow({ id: 'art-2' })],
      (u) => updates.push(u),
    );
    await rejectTier2Artifact({
      artifact_id: 'art-2',
      reviewer_user_id: 'owner-1',
      tenant_id: 't1',
      reason: 'figures wrong',
      artifacts: repo,
    });
    expect(updates).toEqual([
      {
        artifact_id: 'art-2',
        approval_state: 'rejected',
        approved_by: 'owner-1',
      },
    ]);
  });
});
