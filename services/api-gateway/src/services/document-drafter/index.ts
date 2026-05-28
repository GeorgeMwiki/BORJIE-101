/**
 * Document Drafter — public service API.
 *
 * Composes legal / commercial / regulatory documents (contracts,
 * RFPs, RFP responses, letters, notices, memos) and persists them
 * to the `document_drafts` table (migration 0084).
 *
 * The drafter is composition-root agnostic: it depends only on a
 * `DraftPersistence` port (injected by the api-gateway). The default
 * port is a thin wrapper around the Drizzle client.
 *
 * Tenant isolation: every persistence call passes `tenantId`
 * defensively; the underlying RLS policy on `document_drafts`
 * enforces the same predicate at the row level.
 */

import { eq, and, desc } from 'drizzle-orm';
import {
  documentDrafts,
  DRAFT_KINDS,
  DRAFT_LANGUAGES,
  DRAFT_STATUSES,
} from '@borjie/database';
import type {
  DocumentDraft,
  DraftKind,
  DraftLanguage,
  DraftStatus,
  NewDocumentDraft,
} from '@borjie/database/schemas';
import { compose, reviseContent, type SemanticBlockGenerator } from './composer.js';
import { findTemplate, listTemplatesByKind } from './templates/index.js';

// ---------------------------------------------------------------------------
// Persistence port
// ---------------------------------------------------------------------------

export interface DraftPersistence {
  insert(row: NewDocumentDraft): Promise<DocumentDraft>;
  findById(tenantId: string, id: string): Promise<DocumentDraft | null>;
  listByCreator(
    tenantId: string,
    userId: string,
    filters: {
      readonly status?: DraftStatus;
      readonly kind?: DraftKind;
      readonly limit?: number;
    },
  ): Promise<readonly DocumentDraft[]>;
  updateContent(
    tenantId: string,
    id: string,
    updates: {
      readonly contentMd?: string;
      readonly status?: DraftStatus;
      readonly revisionCount?: number;
      readonly lastRevisedAt?: Date;
    },
  ): Promise<DocumentDraft | null>;
}

/**
 * Drizzle-backed persistence. The injected `db` must be a tenant-
 * scoped client (the api-gateway middleware sets
 * `app.current_tenant_id` on every request). The `db` argument is
 * typed as `unknown` at the boundary because the actual
 * `DatabaseClient` type comes from the package barrel and would
 * cause a circular type import here; callers will always pass the
 * real Drizzle client.
 */
export function createDrizzleDraftPersistence(db: unknown): DraftPersistence {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any;
  return {
    async insert(row) {
      const [created] = await client
        .insert(documentDrafts)
        .values(row)
        .returning();
      if (!created) {
        throw new Error('document-drafter: insert returned no row');
      }
      return created as DocumentDraft;
    },
    async findById(tenantId, id) {
      const rows = await client
        .select()
        .from(documentDrafts)
        .where(
          and(
            eq(documentDrafts.tenantId, tenantId),
            eq(documentDrafts.id, id),
          ),
        )
        .limit(1);
      return (rows[0] as DocumentDraft | undefined) ?? null;
    },
    async listByCreator(tenantId, userId, filters) {
      const conds = [
        eq(documentDrafts.tenantId, tenantId),
        eq(documentDrafts.createdByUserId, userId),
      ];
      if (filters.status) conds.push(eq(documentDrafts.status, filters.status));
      if (filters.kind) conds.push(eq(documentDrafts.kind, filters.kind));
      const rows = await client
        .select()
        .from(documentDrafts)
        .where(and(...conds))
        .orderBy(desc(documentDrafts.createdAt))
        .limit(Math.min(filters.limit ?? 100, 500));
      return rows as DocumentDraft[];
    },
    async updateContent(tenantId, id, updates) {
      const set: Record<string, unknown> = {};
      if (updates.contentMd !== undefined) set.contentMd = updates.contentMd;
      if (updates.status !== undefined) set.status = updates.status;
      if (updates.revisionCount !== undefined)
        set.revisionCount = updates.revisionCount;
      if (updates.lastRevisedAt !== undefined)
        set.lastRevisedAt = updates.lastRevisedAt;
      if (Object.keys(set).length === 0) {
        return (await this.findById(tenantId, id)) ?? null;
      }
      const rows = await client
        .update(documentDrafts)
        .set(set)
        .where(
          and(
            eq(documentDrafts.tenantId, tenantId),
            eq(documentDrafts.id, id),
          ),
        )
        .returning();
      return (rows[0] as DocumentDraft | undefined) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ComposeDraftInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly kind: DraftKind;
  readonly templateSlug: string;
  readonly language: DraftLanguage;
  readonly titleSw: string;
  readonly titleEn?: string;
  readonly jurisdiction?: string;
  readonly fillVars: Record<string, unknown>;
  readonly generator?: SemanticBlockGenerator;
}

export interface DraftDrafterDeps {
  readonly persistence: DraftPersistence;
  readonly defaultGenerator?: SemanticBlockGenerator;
}

export function createDocumentDrafter(deps: DraftDrafterDeps): {
  composeDraft(input: ComposeDraftInput): Promise<DocumentDraft>;
  reviseDraft(input: {
    readonly tenantId: string;
    readonly draftId: string;
    readonly instruction: string;
    readonly generator?: SemanticBlockGenerator;
  }): Promise<DocumentDraft>;
  finalizeDraft(input: {
    readonly tenantId: string;
    readonly draftId: string;
  }): Promise<DocumentDraft>;
  listDrafts(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly status?: DraftStatus;
    readonly kind?: DraftKind;
    readonly limit?: number;
  }): Promise<readonly DocumentDraft[]>;
  getDraft(input: {
    readonly tenantId: string;
    readonly draftId: string;
  }): Promise<DocumentDraft | null>;
} {
  const { persistence } = deps;

  async function composeDraft(
    input: ComposeDraftInput,
  ): Promise<DocumentDraft> {
    validateKind(input.kind);
    validateLanguage(input.language);
    const def = findTemplate(input.templateSlug);
    if (!def) {
      throw new Error(
        `document-drafter: unknown template "${input.templateSlug}"`,
      );
    }
    if (def.kind !== input.kind) {
      throw new Error(
        `document-drafter: template "${input.templateSlug}" produces "${def.kind}", not "${input.kind}"`,
      );
    }
    const generator = input.generator ?? deps.defaultGenerator;
    const composed = await compose({
      kind: input.kind,
      templateSlug: input.templateSlug,
      language: input.language,
      fillVars: input.fillVars,
      ...(generator !== undefined ? { generator } : {}),
    });
    const row = await persistence.insert({
      tenantId: input.tenantId,
      createdByUserId: input.userId,
      kind: input.kind,
      status: 'drafting',
      titleSw: input.titleSw,
      titleEn: input.titleEn ?? null,
      jurisdiction: input.jurisdiction ?? def.defaultJurisdiction,
      language: input.language,
      contentMd: composed.contentMd,
      sourceTemplateSlug: input.templateSlug,
      revisionCount: 1,
      lastRevisedAt: new Date(),
      parentDraftId: null,
    });
    return row;
  }

  async function reviseDraft(input: {
    readonly tenantId: string;
    readonly draftId: string;
    readonly instruction: string;
    readonly generator?: SemanticBlockGenerator;
  }): Promise<DocumentDraft> {
    if (input.instruction.trim().length === 0) {
      throw new Error('document-drafter: revision instruction must not be empty');
    }
    const parent = await persistence.findById(input.tenantId, input.draftId);
    if (!parent) {
      throw new Error(`document-drafter: parent draft ${input.draftId} not found`);
    }
    if (parent.status === 'finalized' || parent.status === 'sent') {
      throw new Error(
        `document-drafter: cannot revise a ${parent.status} draft`,
      );
    }
    const reviseGenerator = input.generator ?? deps.defaultGenerator;
    const revisedContent = await reviseContent({
      originalContent: parent.contentMd,
      instruction: input.instruction,
      language: parent.language as DraftLanguage,
      ...(reviseGenerator !== undefined ? { generator: reviseGenerator } : {}),
    });
    const revisionRow = await persistence.insert({
      tenantId: parent.tenantId,
      createdByUserId: parent.createdByUserId,
      kind: parent.kind,
      status: 'drafting',
      titleSw: parent.titleSw,
      titleEn: parent.titleEn,
      jurisdiction: parent.jurisdiction,
      language: parent.language,
      contentMd: revisedContent,
      sourceTemplateSlug: parent.sourceTemplateSlug,
      revisionCount: parent.revisionCount + 1,
      lastRevisedAt: new Date(),
      parentDraftId: parent.id,
    });
    return revisionRow;
  }

  async function finalizeDraft(input: {
    readonly tenantId: string;
    readonly draftId: string;
  }): Promise<DocumentDraft> {
    const existing = await persistence.findById(input.tenantId, input.draftId);
    if (!existing) {
      throw new Error(`document-drafter: draft ${input.draftId} not found`);
    }
    if (existing.status === 'finalized') {
      return existing;
    }
    const updated = await persistence.updateContent(
      input.tenantId,
      input.draftId,
      { status: 'finalized' },
    );
    if (!updated) {
      throw new Error(`document-drafter: failed to finalize ${input.draftId}`);
    }
    return updated;
  }

  return {
    composeDraft,
    reviseDraft,
    finalizeDraft,
    async listDrafts(input) {
      return persistence.listByCreator(input.tenantId, input.userId, {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    async getDraft(input) {
      return persistence.findById(input.tenantId, input.draftId);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateKind(kind: string): asserts kind is DraftKind {
  if (!(DRAFT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`document-drafter: invalid kind "${kind}"`);
  }
}

function validateLanguage(language: string): asserts language is DraftLanguage {
  if (!(DRAFT_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error(`document-drafter: invalid language "${language}"`);
  }
}

export function isValidDraftStatus(status: string): status is DraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(status);
}

export { listTemplatesByKind, findTemplate } from './templates/index.js';
export { TEMPLATE_REGISTRY } from './templates/index.js';
export type { SemanticBlockGenerator } from './composer.js';
