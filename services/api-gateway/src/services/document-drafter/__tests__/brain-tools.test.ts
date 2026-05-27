/**
 * Tests for the brain-tool wrappers exposed via
 * `buildDocumentDrafterTools`. Each tool's `execute` is exercised
 * with an in-memory persistence shim.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildDocumentDrafterTools } from '../brain-tools';
import type { DraftPersistence } from '../index';
import type { DocumentDraft, NewDocumentDraft } from '@borjie/database';

function memoryPersistence(): DraftPersistence & { readonly rows: DocumentDraft[] } {
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
      let res = rows.filter(
        (r) => r.tenantId === tenantId && r.createdByUserId === userId,
      );
      if (filters.status) res = res.filter((r) => r.status === filters.status);
      if (filters.kind) res = res.filter((r) => r.kind === filters.kind);
      return res.slice(0, filters.limit ?? 100);
    },
    async updateContent(tenantId, id, updates) {
      const idx = rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
      if (idx === -1) return null;
      const merged: DocumentDraft = {
        ...rows[idx],
        ...(updates.contentMd !== undefined && { contentMd: updates.contentMd }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.revisionCount !== undefined && { revisionCount: updates.revisionCount }),
        ...(updates.lastRevisedAt !== undefined && { lastRevisedAt: updates.lastRevisedAt }),
      };
      rows[idx] = merged;
      return merged;
    },
  };
}

function makeContext(tenantId = 't1', userId = 'u1'): {
  tenant: { tenantId: string; tenantName: string; environment: 'development' };
  actor: { type: 'user'; id: string };
  persona: { id: string };
  threadId: string;
} {
  return {
    tenant: { tenantId, tenantName: 'Acme Mining', environment: 'development' },
    actor: { type: 'user', id: userId },
    persona: { id: 'p1' },
    threadId: 't1',
  };
}

describe('brain-tools — registration shape', () => {
  it('exposes five tools with expected names', () => {
    const tools = buildDocumentDrafterTools({ persistence: memoryPersistence() });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'skill.docs.draft_contract',
        'skill.docs.draft_letter',
        'skill.docs.draft_rfp',
        'skill.docs.draft_rfp_response',
        'skill.docs.revise_draft',
      ].sort(),
    );
  });

  it('each tool description is non-empty', () => {
    const tools = buildDocumentDrafterTools({ persistence: memoryPersistence() });
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

describe('brain-tools — draft_contract', () => {
  it('drafts a supply-ore contract and returns a preview', async () => {
    const store = memoryPersistence();
    const [draftContract] = buildDocumentDrafterTools({ persistence: store });
    const result = await draftContract.execute(
      {
        kind: 'supply-ore',
        parties: { sellerName: 'Mwikila', buyerName: 'EA Refiners' },
        terms: { unitPrice: 1000, totalQuantity: 50 },
        currency: 'USD',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(result.ok).toBe(true);
    expect(result.evidenceSummary).toContain('contract.supply-ore');
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.kind).toBe('contract');
  });

  it('returns ok:false on missing kind parameter', async () => {
    const [draftContract] = buildDocumentDrafterTools({ persistence: memoryPersistence() });
    const result = await draftContract.execute(
      { parties: {}, terms: {} },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/kind/);
  });
});

describe('brain-tools — draft_rfp', () => {
  it('drafts an equipment-purchase RFP', async () => {
    const store = memoryPersistence();
    const tools = buildDocumentDrafterTools({ persistence: store });
    const draftRfp = tools.find((t) => t.name === 'skill.docs.draft_rfp');
    expect(draftRfp).toBeDefined();
    const result = await draftRfp!.execute(
      {
        purpose: 'equipment-purchase',
        requirements: { siteName: 'Geita', requirementsTable: '| Excavator | 1 | 30T |' },
        deadline: '2026-07-01',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(result.ok).toBe(true);
    expect(store.rows[0]?.kind).toBe('rfp');
  });
});

describe('brain-tools — draft_letter', () => {
  it('drafts a TUMEMADINI letter', async () => {
    const store = memoryPersistence();
    const tools = buildDocumentDrafterTools({ persistence: store });
    const draftLetter = tools.find((t) => t.name === 'skill.docs.draft_letter');
    const result = await draftLetter!.execute(
      {
        recipient: 'tumemadini',
        subject: 'License renewal',
        intent: { licenceNumber: 'PL-100', siteName: 'Geita' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(result.ok).toBe(true);
    expect(store.rows[0]?.sourceTemplateSlug).toBe('letter.regulator.tumemadini');
  });
});

describe('brain-tools — revise_draft', () => {
  it('produces a child revision linked via parent_draft_id', async () => {
    const store = memoryPersistence();
    const tools = buildDocumentDrafterTools({ persistence: store });
    const draftContract = tools.find((t) => t.name === 'skill.docs.draft_contract')!;
    const reviseDraft = tools.find((t) => t.name === 'skill.docs.revise_draft')!;
    const initial = await draftContract.execute(
      {
        kind: 'supply-ore',
        parties: { sellerName: 'X' },
        terms: { unitPrice: 1 },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(initial.ok).toBe(true);
    const initialData = initial.data as { draftId: string };
    const revision = await reviseDraft.execute(
      { draftId: initialData.draftId, revisionInstruction: 'Tighten the scope.' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeContext() as any,
    );
    expect(revision.ok).toBe(true);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]?.parentDraftId).toBe(initialData.draftId);
    expect(store.rows[1]?.revisionCount).toBe(2);
  });
});
