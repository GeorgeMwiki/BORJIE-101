/**
 * Tests for the public `createDocumentDrafter` API.
 * Uses an in-memory `DraftPersistence` shim so we exercise the
 * composer + lifecycle logic without a Postgres dependency.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDocumentDrafter, type DraftPersistence } from '../index';
import type { DocumentDraft, NewDocumentDraft } from '@borjie/database';

function createMemoryPersistence(): DraftPersistence & {
  readonly rows: DocumentDraft[];
} {
  const rows: DocumentDraft[] = [];
  return {
    rows,
    async insert(row: NewDocumentDraft): Promise<DocumentDraft> {
      const persisted: DocumentDraft = {
        id: randomUUID(),
        tenantId: row.tenantId as string,
        createdByUserId: row.createdByUserId as string,
        kind: row.kind as string,
        status: (row.status as string | undefined) ?? 'drafting',
        titleSw: row.titleSw as string,
        titleEn: (row.titleEn as string | null | undefined) ?? null,
        jurisdiction: (row.jurisdiction as string | null | undefined) ?? null,
        language: (row.language as string | undefined) ?? 'sw',
        contentMd: row.contentMd as string,
        sourceTemplateSlug: row.sourceTemplateSlug as string,
        revisionCount: (row.revisionCount as number | undefined) ?? 1,
        lastRevisedAt: (row.lastRevisedAt as Date | undefined) ?? new Date(),
        parentDraftId: (row.parentDraftId as string | null | undefined) ?? null,
        hashChainId: null,
        createdAt: new Date(),
      };
      rows.push(persisted);
      return persisted;
    },
    async findById(tenantId, id) {
      return rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
    },
    async listByCreator(tenantId, userId, filters) {
      let matches = rows.filter(
        (r) => r.tenantId === tenantId && r.createdByUserId === userId,
      );
      if (filters.status) matches = matches.filter((r) => r.status === filters.status);
      if (filters.kind) matches = matches.filter((r) => r.kind === filters.kind);
      return matches
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filters.limit ?? 100);
    },
    async updateContent(tenantId, id, updates) {
      const idx = rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
      if (idx === -1) return null;
      const next: DocumentDraft = {
        ...rows[idx],
        ...(updates.contentMd !== undefined && { contentMd: updates.contentMd }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.revisionCount !== undefined && { revisionCount: updates.revisionCount }),
        ...(updates.lastRevisedAt !== undefined && { lastRevisedAt: updates.lastRevisedAt }),
      };
      rows[idx] = next;
      return next;
    },
  };
}

describe('createDocumentDrafter — composeDraft', () => {
  let store: ReturnType<typeof createMemoryPersistence>;

  beforeEach(() => {
    store = createMemoryPersistence();
  });

  it('composes a contract draft and persists it', async () => {
    const drafter = createDocumentDrafter({ persistence: store });
    const draft = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'contract',
      templateSlug: 'contract.supply-ore',
      language: 'sw',
      titleSw: 'Mkataba — Acme',
      fillVars: { sellerName: 'Acme', buyerName: 'Buyer Co' },
    });
    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe('drafting');
    expect(draft.revisionCount).toBe(1);
    expect(draft.contentMd).toContain('Acme');
    expect(draft.sourceTemplateSlug).toBe('contract.supply-ore');
    expect(store.rows).toHaveLength(1);
  });

  it('rejects unknown template slugs', async () => {
    const drafter = createDocumentDrafter({ persistence: store });
    await expect(
      drafter.composeDraft({
        tenantId: 't1',
        userId: 'u1',
        kind: 'contract',
        templateSlug: 'contract.unknown',
        language: 'sw',
        titleSw: 'X',
        fillVars: {},
      }),
    ).rejects.toThrow(/unknown template/);
  });

  it('rejects kind/template mismatch', async () => {
    const drafter = createDocumentDrafter({ persistence: store });
    await expect(
      drafter.composeDraft({
        tenantId: 't1',
        userId: 'u1',
        // Wrong kind for the slug below.
        kind: 'rfp',
        templateSlug: 'contract.supply-ore',
        language: 'sw',
        titleSw: 'X',
        fillVars: {},
      }),
    ).rejects.toThrow(/produces "contract"/);
  });

  it('defaults jurisdiction from template registry when omitted', async () => {
    const drafter = createDocumentDrafter({ persistence: store });
    const draft = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'letter',
      templateSlug: 'letter.regulator.tumemadini',
      language: 'sw',
      titleSw: 'Test letter',
      fillVars: {},
    });
    expect(draft.jurisdiction).toBe('TZ');
  });
});

describe('createDocumentDrafter — reviseDraft', () => {
  it('chains revisions via parent_draft_id and bumps revision_count', async () => {
    const store = createMemoryPersistence();
    const drafter = createDocumentDrafter({ persistence: store });
    const parent = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'Memo',
      fillVars: { tenantName: 'X', fromName: 'M', fromRole: 'F', toName: 'A', toRole: 'B' },
    });
    const revision = await drafter.reviseDraft({
      tenantId: 't1',
      draftId: parent.id,
      instruction: 'Soften the tone.',
    });
    expect(revision.parentDraftId).toBe(parent.id);
    expect(revision.revisionCount).toBe(parent.revisionCount + 1);
    expect(revision.id).not.toBe(parent.id);
    expect(store.rows).toHaveLength(2);
  });

  it('refuses to revise a finalized draft', async () => {
    const store = createMemoryPersistence();
    const drafter = createDocumentDrafter({ persistence: store });
    const parent = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'Memo',
      fillVars: {},
    });
    await drafter.finalizeDraft({ tenantId: 't1', draftId: parent.id });
    await expect(
      drafter.reviseDraft({
        tenantId: 't1',
        draftId: parent.id,
        instruction: 'Change something.',
      }),
    ).rejects.toThrow(/cannot revise a finalized/);
  });

  it('rejects empty revision instructions', async () => {
    const store = createMemoryPersistence();
    const drafter = createDocumentDrafter({ persistence: store });
    const parent = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'X',
      fillVars: {},
    });
    await expect(
      drafter.reviseDraft({
        tenantId: 't1',
        draftId: parent.id,
        instruction: '   ',
      }),
    ).rejects.toThrow(/must not be empty/);
  });
});

describe('createDocumentDrafter — finalize + list', () => {
  it('finalizes a draft and is idempotent', async () => {
    const store = createMemoryPersistence();
    const drafter = createDocumentDrafter({ persistence: store });
    const draft = await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'M',
      fillVars: {},
    });
    const finalized = await drafter.finalizeDraft({ tenantId: 't1', draftId: draft.id });
    expect(finalized.status).toBe('finalized');
    const again = await drafter.finalizeDraft({ tenantId: 't1', draftId: draft.id });
    expect(again.status).toBe('finalized');
  });

  it('listDrafts isolates by tenant and creator', async () => {
    const store = createMemoryPersistence();
    const drafter = createDocumentDrafter({ persistence: store });
    await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'A',
      fillVars: {},
    });
    await drafter.composeDraft({
      tenantId: 't2',
      userId: 'u1',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'B',
      fillVars: {},
    });
    await drafter.composeDraft({
      tenantId: 't1',
      userId: 'u2',
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'C',
      fillVars: {},
    });
    const t1u1 = await drafter.listDrafts({ tenantId: 't1', userId: 'u1' });
    expect(t1u1).toHaveLength(1);
    expect(t1u1[0]?.titleSw).toBe('A');
  });
});
