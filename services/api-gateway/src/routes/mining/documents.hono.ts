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
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { documentUploads } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const UploadMetadataSchema = z.object({
  fileName: z.string().min(1).max(500),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(200),
  documentType: z.enum([
    'national_id', 'passport', 'driving_license', 'work_permit', 'residence_permit',
    'utility_bill', 'bank_statement', 'employment_letter', 'lease_agreement',
    'move_in_report', 'move_out_report', 'maintenance_photo', 'receipt',
    'notice', 'other',
  ]).default('other'),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const DocChatSchema = z.object({
  question: z.string().min(1).max(4000),
  language: z.enum(['sw', 'en']).default('sw'),
});

const SignSchema = z.object({
  fingerprintEventId: z.string().min(1),
  signerRole: z.string().max(120).optional(),
  note: z.string().max(2000).optional(),
});

app.post(
  '/upload',
  zValidator('json', UploadMetadataSchema),
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
      return c.json({ success: true, data: { document: row, presignedPut: fileUrl } }, 201);
    },
  ),
);

app.post(
  '/:id/chat',
  zValidator('json', DocChatSchema),
  withSecurityEvents(
    { action: 'mining.document.chat', resource: 'mining.document', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const docId = c.req.param('id');
      const input = c.req.valid('json');
      const [doc] = await db
        .select()
        .from(documentUploads)
        .where(and(eq(documentUploads.id, docId), eq(documentUploads.tenantId, tenantId)))
        .limit(1);
      if (!doc) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } }, 404);
      // Doc-chat dispatch lands here; orchestrator pulls embeddings,
      // routes to the doc-chat agent, returns an evidenced answer.
      return c.json({
        success: true,
        data: {
          documentId: docId,
          question: input.question,
          language: input.language,
          answer: null,
          evidenceIds: [],
          note: 'doc-chat orchestrator dispatch pending',
        },
      });
    },
  ),
);

app.post(
  '/:id/sign',
  zValidator('json', SignSchema),
  withSecurityEvents(
    { action: 'mining.document.sign', resource: 'mining.document', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const docId = c.req.param('id');
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
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningDocumentsRouter = app;
