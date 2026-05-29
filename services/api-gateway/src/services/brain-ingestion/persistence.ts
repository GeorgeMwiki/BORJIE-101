/**
 * Persistence layer for the Company-Brain ingestion service. Wraps the
 * Drizzle inserts behind a small port so the orchestrator stays test-able
 * without a live Postgres.
 *
 * Wave COMPANY-BRAIN (C-1).
 */

import { sql } from 'drizzle-orm';
import {
  corpusDocUploads,
  corpusDocSummaries,
  intelligenceCorpusChunks,
} from '@borjie/database';
import type {
  CorpusSourceKind,
  CorpusUploadStatus,
  NewCorpusDocUpload,
  NewCorpusDocSummary,
} from '@borjie/database';

import type { EmbeddedChunk, Summary } from './types.js';

export interface IngestionDb {
  insert(table: unknown): {
    values(row: Record<string, unknown>): {
      returning(): Promise<ReadonlyArray<Record<string, unknown>>>;
      onConflictDoUpdate(args: {
        target: ReadonlyArray<unknown>;
        set: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
  update(table: unknown): {
    set(row: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  execute(query: unknown): Promise<unknown>;
}

export interface IngestionPersistence {
  insertUpload(row: {
    readonly tenantId: string;
    readonly uploadedByUserId: string;
    readonly sourceKind: CorpusSourceKind;
    readonly originalFilename: string;
    readonly sizeBytes: number;
    readonly storageUrl: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly uploadId: string }>;

  updateUploadStatus(args: {
    readonly uploadId: string;
    readonly status: CorpusUploadStatus;
    readonly chunksCount?: number | undefined;
    readonly entitiesExtracted?: number | undefined;
    readonly errorMessage?: string | undefined;
    readonly markProcessed?: boolean | undefined;
  }): Promise<void>;

  upsertChunks(args: {
    readonly tenantId: string;
    readonly uploadId: string;
    readonly originalFilename: string;
    readonly chunks: ReadonlyArray<EmbeddedChunk>;
    readonly language: 'en' | 'sw' | 'unknown';
  }): Promise<void>;

  insertSummary(args: {
    readonly tenantId: string;
    readonly uploadId: string;
    readonly summary: Summary;
  }): Promise<void>;
}

export function createDrizzlePersistence(db: IngestionDb): IngestionPersistence {
  return {
    async insertUpload(row) {
      const rows = await db
        .insert(corpusDocUploads)
        .values({
          tenantId: row.tenantId,
          uploadedByUserId: row.uploadedByUserId,
          sourceKind: row.sourceKind,
          originalFilename: row.originalFilename,
          sizeBytes: row.sizeBytes,
          storageUrl: row.storageUrl,
          status: 'pending',
          metadata: row.metadata,
        } satisfies Partial<NewCorpusDocUpload> as Record<string, unknown>)
        .returning();
      const first = rows[0];
      const uploadId =
        first && typeof first['id'] === 'string'
          ? first['id']
          : String(first?.['id'] ?? '');
      if (!uploadId) throw new Error('insertUpload: missing id');
      return Object.freeze({ uploadId });
    },

    async updateUploadStatus(args) {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.chunksCount !== undefined) patch['chunksCount'] = args.chunksCount;
      if (args.entitiesExtracted !== undefined)
        patch['entitiesExtracted'] = args.entitiesExtracted;
      if (args.errorMessage !== undefined)
        patch['errorMessage'] = args.errorMessage.slice(0, 2000);
      if (args.markProcessed) patch['processedAt'] = new Date();
      await db
        .update(corpusDocUploads)
        .set(patch)
        .where(sql`id = ${args.uploadId}`);
    },

    async upsertChunks(args) {
      // intelligence_corpus_chunks has UNIQUE(source_file, section). We
      // synthesize a per-chunk source_file of `tenant://<tenantId>/upload/<uploadId>/chunk/<n>`
      // so chunks from this upload occupy a private namespace and we
      // never collide with the global corpus.
      for (const chunk of args.chunks) {
        const sourceFile = `tenant://${args.tenantId}/upload/${args.uploadId}`;
        await db
          .insert(intelligenceCorpusChunks)
          .values({
            id: chunk.id,
            tenantId: args.tenantId,
            sourceFile,
            section: chunk.section ?? `chunk-${chunk.chunkIndex}`,
            text: chunk.text,
            embedding: [...chunk.embedding],
            language: args.language === 'unknown' ? 'en' : args.language,
            metadata: {
              uploadId: args.uploadId,
              chunkIndex: chunk.chunkIndex,
              originalFilename: args.originalFilename,
            },
          } as Record<string, unknown>)
          .onConflictDoUpdate({
            target: [
              intelligenceCorpusChunks.sourceFile,
              intelligenceCorpusChunks.section,
            ],
            set: {
              text: chunk.text,
              embedding: [...chunk.embedding],
            },
          });
      }
    },

    async insertSummary(args) {
      await db
        .insert(corpusDocSummaries)
        .values({
          uploadId: args.uploadId,
          tenantId: args.tenantId,
          summaryMd: args.summary.summaryMd,
          summaryEn: args.summary.summaryEn,
          summarySw: args.summary.summarySw,
          keyFacts: args.summary.keyFacts.map((f) => ({ ...f })),
        } satisfies Partial<NewCorpusDocSummary> as Record<string, unknown>)
        .onConflictDoUpdate({
          target: [corpusDocSummaries.uploadId],
          set: {
            summaryMd: args.summary.summaryMd,
            summaryEn: args.summary.summaryEn,
            summarySw: args.summary.summarySw,
            keyFacts: args.summary.keyFacts.map((f) => ({ ...f })),
          },
        });
    },
  };
}
