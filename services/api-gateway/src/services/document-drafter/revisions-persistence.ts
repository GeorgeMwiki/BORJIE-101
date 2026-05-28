/**
 * Persistence helpers for draft_revisions + draft_citations
 * (migration 0100).
 *
 * Wave UNIVERSAL-DOC-DRAFTER. The api-gateway holds a Drizzle client
 * per request (the tenant GUC is bound by `databaseMiddleware`). These
 * helpers wrap the schema tables behind a small port so unit tests can
 * inject an in-memory implementation.
 *
 * Audit chaining: every revision row stores a sha256 hash of the
 * `(tenantId, draftId, revisionNo, contentMd, citations[])` payload so
 * we can later prove tamper-evidence without recomputing the whole
 * chain.
 */

import { createHash } from 'node:crypto';
import * as drizzleOrm from 'drizzle-orm';
import {
  draftRevisions,
  draftCitations,
  documentDrafts,
  type DraftRevision,
  type NewDraftRevision,
  type DraftCitation,
  type NewDraftCitation,
} from '@borjie/database/schemas';

// drizzle's strict types fight with exactOptionalPropertyTypes when
// the table inputs include defaulted columns. Cast at the boundary so
// the rest of the module stays tidy and the runtime behaviour is
// unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eq = drizzleOrm.eq as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const and = drizzleOrm.and as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asc = drizzleOrm.asc as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const desc = drizzleOrm.desc as any;

export interface RevisionInput {
  readonly tenantId: string;
  readonly draftId: string;
  readonly revisionNo: number;
  readonly contentMd: string;
  readonly contentFormat?: 'markdown' | 'html' | 'plain';
  readonly renderedBlobUrl?: string | null;
  readonly createdBy: string;
  readonly citations?: ReadonlyArray<{
    readonly sourceKind: string;
    readonly sourceRef: string;
    readonly snippetUsed?: string | null;
  }>;
}

export interface CitationInput {
  readonly tenantId: string;
  readonly draftId: string;
  readonly revisionId: string;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly snippetUsed?: string | null;
}

export interface RevisionsPersistence {
  insertRevision(input: RevisionInput): Promise<DraftRevision>;
  listRevisions(tenantId: string, draftId: string): Promise<readonly DraftRevision[]>;
  getRevision(
    tenantId: string,
    draftId: string,
    revisionNo: number,
  ): Promise<DraftRevision | null>;
  insertCitation(input: CitationInput): Promise<DraftCitation>;
  listCitations(tenantId: string, revisionId: string): Promise<readonly DraftCitation[]>;
  bumpDraftCurrentRevision(
    tenantId: string,
    draftId: string,
    revisionNo: number,
  ): Promise<void>;
}

export function createDrizzleRevisionsPersistence(
  db: unknown,
): RevisionsPersistence {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any;
  return {
    async insertRevision(input) {
      const citations = input.citations ?? [];
      const auditHash = computeRevisionHash(input);
      const row: NewDraftRevision = {
        tenantId: input.tenantId,
        draftId: input.draftId,
        revisionNo: input.revisionNo,
        contentMd: input.contentMd,
        contentFormat: input.contentFormat ?? 'markdown',
        renderedBlobUrl: input.renderedBlobUrl ?? null,
        createdBy: input.createdBy,
        citations: citations as unknown as object,
        auditHash,
      };
      const [created] = await client
        .insert(draftRevisions)
        .values(row)
        .returning();
      if (!created) {
        throw new Error('revisions-persistence: insert returned no row');
      }
      return created as DraftRevision;
    },
    async listRevisions(tenantId, draftId) {
      const rows = await client
        .select()
        .from(draftRevisions)
        .where(
          and(
            eq(draftRevisions.tenantId, tenantId),
            eq(draftRevisions.draftId, draftId),
          ),
        )
        .orderBy(asc(draftRevisions.revisionNo));
      return rows as DraftRevision[];
    },
    async getRevision(tenantId, draftId, revisionNo) {
      const rows = await client
        .select()
        .from(draftRevisions)
        .where(
          and(
            eq(draftRevisions.tenantId, tenantId),
            eq(draftRevisions.draftId, draftId),
            eq(draftRevisions.revisionNo, revisionNo),
          ),
        )
        .limit(1);
      return (rows[0] as DraftRevision | undefined) ?? null;
    },
    async insertCitation(input) {
      const row: NewDraftCitation = {
        tenantId: input.tenantId,
        draftId: input.draftId,
        revisionId: input.revisionId,
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        snippetUsed: input.snippetUsed ?? null,
      };
      const [created] = await client
        .insert(draftCitations)
        .values(row)
        .returning();
      if (!created) {
        throw new Error('revisions-persistence: citation insert returned no row');
      }
      return created as DraftCitation;
    },
    async listCitations(tenantId, revisionId) {
      const rows = await client
        .select()
        .from(draftCitations)
        .where(
          and(
            eq(draftCitations.tenantId, tenantId),
            eq(draftCitations.revisionId, revisionId),
          ),
        )
        .orderBy(desc(draftCitations.createdAt));
      return rows as DraftCitation[];
    },
    async bumpDraftCurrentRevision(tenantId, draftId, revisionNo) {
      await client
        .update(documentDrafts)
        .set({ currentRevisionNo: revisionNo, updatedAt: new Date() })
        .where(
          and(
            eq(documentDrafts.tenantId, tenantId),
            eq(documentDrafts.id, draftId),
          ),
        );
    },
  };
}

export function computeRevisionHash(input: RevisionInput): string {
  const canonical = JSON.stringify({
    t: input.tenantId,
    d: input.draftId,
    n: input.revisionNo,
    c: input.contentMd,
    s: (input.citations ?? []).map((x) => ({
      k: x.sourceKind,
      r: x.sourceRef,
      e: x.snippetUsed ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
