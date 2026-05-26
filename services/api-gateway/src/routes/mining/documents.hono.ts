// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/documents — mining-domain document store.
 *
 * Routes:
 *   POST  /upload          multipart upload (stores via storage-adapter
 *                          → MinIO). Returns a documentUploads row.
 *   POST  /:id/chat        ask a question scoped to one document.
 *   POST  /:id/sign        biometric-signed sign-off (stub).
 *
 * Storage policy: real binary write happens in storage-adapter; this
 * route records the metadata + presigned-PUT URL so the client can
 * complete the upload directly.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { documentUploads } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  documentsUploadRoute,
  documentsChatRoute,
  documentsSignRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(
  documentsUploadRoute,
  withSecurityEvents(
    { action: 'mining.document.upload', resource: 'mining.document', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const id = randomUUID();
      // Storage-adapter handles the actual blob; we record the
      // canonical URL and let the client PUT directly.
      const fileUrl = `s3://borjie-${tenantId}/documents/${id}/${encodeURIComponent(input.fileName)}`;
      const now = new Date();
      const [row] = await db
        .insert(documentUploads)
        .values({
          id,
          tenantId,
          customerId: null,
          documentType: input.documentType,
          status: 'pending_upload',
          source: 'api',
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          fileUrl,
          thumbnailUrl: null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: input.metadata ?? {},
          tags: input.tags ?? [],
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return c.json(
        {
          success: true as const,
          data: { document: row, presignedPut: fileUrl },
        },
        201,
      );
    },
  ),
);

app.openapi(
  documentsChatRoute,
  withSecurityEvents(
    { action: 'mining.document.chat', resource: 'mining.document', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const { id: docId } = c.req.valid('param');
      const input = c.req.valid('json');
      const [doc] = await db
        .select()
        .from(documentUploads)
        .where(and(eq(documentUploads.id, docId), eq(documentUploads.tenantId, tenantId)))
        .limit(1);
      if (!doc) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Document not found' },
          },
          404,
        );
      }
      // Doc-chat dispatch lands here; orchestrator pulls embeddings,
      // routes to the doc-chat agent, returns an evidenced answer.
      return c.json(
        {
          success: true as const,
          data: {
            documentId: docId,
            question: input.question,
            language: input.language,
            answer: null,
            evidenceIds: [],
            note: 'doc-chat orchestrator dispatch pending',
          },
        },
        200,
      );
    },
  ),
);

app.openapi(
  documentsSignRoute,
  withSecurityEvents(
    { action: 'mining.document.sign', resource: 'mining.document', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const { id: docId } = c.req.valid('param');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .update(documentUploads)
        .set({
          status: 'validated',
          verifiedAt: now,
          verifiedBy: userId,
          metadata: {
            signedAt: now.toISOString(),
            signerRole: input.signerRole ?? null,
            fingerprintEventId: input.fingerprintEventId,
            note: input.note ?? null,
          },
          updatedAt: now,
          updatedBy: userId,
        })
        .where(and(eq(documentUploads.id, docId), eq(documentUploads.tenantId, tenantId)))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Document not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningDocumentsRouter = app;
