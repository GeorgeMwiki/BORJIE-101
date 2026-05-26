import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { paginateArray } from './db-mappers';

import { withSecurityEvents } from '@borjie/observability';
// Document uploads are metadata records; the blob itself is uploaded to
// object storage beforehand and referenced by `url`. We cap size at 50MB
// (matches most WhatsApp/document gateway limits) and enforce a mime
// allowlist server-side so clients can't sneak executables past the UI.
const MAX_DOC_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
];
const DocumentCreateSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().refine((m) => ALLOWED_MIMES.includes(m), 'mime type not allowed'),
  size: z.number().int().positive().max(MAX_DOC_SIZE_BYTES),
  url: z.string().url(),
  type: z.string().max(50).optional(),
  customerId: z.string().optional(),
  relatedEntityType: z.string().max(50).optional(),
  relatedEntityId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
const DocumentUpdateSchema = z.object({
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.string().optional(),
  relatedEntityType: z.string().max(50).optional(),
  relatedEntityId: z.string().optional(),
});

function mapDocumentStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'validated':
      return 'VERIFIED';
    case 'rejected':
      return 'REJECTED';
    default:
      return 'PENDING';
  }
}

function mapDocumentType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'lease_agreement':
      return 'LEASE';
    case 'move_in_report':
    case 'move_out_report':
      return 'INSPECTION_REPORT';
    case 'receipt':
      return 'RECEIPT';
    case 'notice':
      return 'NOTICE';
    case 'national_id':
    case 'passport':
    case 'driving_license':
    case 'work_permit':
    case 'residence_permit':
      return 'ID_DOCUMENT';
    default:
      return String(type || 'OTHER').toUpperCase();
  }
}

function mapCategory(type) {
  switch (type) {
    case 'LEASE':
      return 'leases';
    case 'RECEIPT':
    case 'INVOICE':
    case 'STATEMENT':
      return 'financial';
    case 'NOTICE':
      return 'compliance';
    case 'INSPECTION_REPORT':
      return 'reports';
    case 'ID_DOCUMENT':
      return 'identity';
    default:
      return 'other';
  }
}

function mapDocumentRow(row) {
  const type = mapDocumentType(row.documentType);
  const metadata = row.metadata || {};
  return {
    id: row.id,
    type,
    category: mapCategory(type),
    name: row.fileName,
    mimeType: row.mimeType,
    size: row.fileSize,
    url: row.fileUrl,
    verificationStatus: mapDocumentStatus(row.status),
    verifiedAt: row.verifiedAt,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    property: metadata.propertyId
      ? { id: metadata.propertyId, name: metadata.propertyName || metadata.propertyId }
      : undefined,
    unit: metadata.unitId
      ? { id: metadata.unitId, unitNumber: metadata.unitNumber || metadata.unitId }
      : undefined,
    customer: row.customerId
      ? {
          id: row.customerId,
          name: metadata.customerName || row.customerId,
        }
      : undefined,
    requiresSignature: Boolean(metadata.requiresSignature),
    signatureStatus: metadata.signedAt ? 'SIGNED' : metadata.requiresSignature ? 'PENDING' : undefined,
    signedAt: metadata.signedAt,
    signedBy: metadata.signedBy,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const page = Number(c.req.query('page') || '1');
  const pageSize = Number(c.req.query('pageSize') || '20');
  const type = c.req.query('type');
  const status = c.req.query('status');
  const relatedEntityType = c.req.query('relatedEntityType');
  const relatedEntityId = c.req.query('relatedEntityId');
  const customerId = c.req.query('customerId');

  const result = await repos.documents.findMany(auth.tenantId, {
    documentType:
      type === 'LEASE'
        ? 'lease_agreement'
        : type === 'ID_DOCUMENT'
        ? 'national_id'
        : type?.toLowerCase(),
    status:
      status === 'VERIFIED'
        ? 'validated'
        : status === 'REJECTED'
        ? 'rejected'
        : status
        ? 'uploaded'
        : undefined,
    entityType: relatedEntityType,
    entityId: relatedEntityId,
    customerId,
    limit: 2000,
    offset: 0,
  });

  const paginated = paginateArray(result.items.map(mapDocumentRow), page, pageSize);
  return c.json({ success: true, data: paginated.data, pagination: paginated.pagination });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const row = await repos.documents.findById(c.req.param('id'), auth.tenantId);

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } }, 404);
  }

  return c.json({ success: true, data: mapDocumentRow(row) });
});

app.post('/', zValidator('json', DocumentCreateSchema), withSecurityEvents({ action: 'document.create', resource: 'document', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  const documentType =
    body.type === 'LEASE'
      ? 'lease_agreement'
      : body.type === 'ID_DOCUMENT'
      ? 'national_id'
      : String(body.type || 'other').toLowerCase();

  const row = await repos.documents.create({
    id: crypto.randomUUID(),
    tenantId: auth.tenantId,
    customerId: body.customerId,
    documentType,
    status: 'uploaded',
    source: 'api',
    fileName: body.name,
    fileSize: body.size,
    mimeType: body.mimeType,
    fileUrl: body.url,
    entityType: body.relatedEntityType,
    entityId: body.relatedEntityId,
    tags: body.tags || [],
    metadata: body.metadata || {},
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });

  return c.json({ success: true, data: mapDocumentRow(row) }, 201);
}));

app.put('/:id', zValidator('json', DocumentUpdateSchema), withSecurityEvents({ action: 'document.update', resource: 'document', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  const existing = await repos.documents.findById(c.req.param('id'), auth.tenantId);

  if (!existing) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } }, 404);
  }

  const row = await repos.documents.update(c.req.param('id'), auth.tenantId, {
    fileName: body.name ?? existing.fileName,
    tags: body.tags ?? existing.tags,
    status:
      body.verificationStatus === 'VERIFIED'
        ? 'validated'
        : body.verificationStatus === 'REJECTED'
        ? 'rejected'
        : existing.status,
    verifiedAt: body.verificationStatus === 'VERIFIED' ? new Date() : existing.verifiedAt,
    verifiedBy: body.verificationStatus === 'VERIFIED' ? auth.userId : existing.verifiedBy,
    rejectedAt: body.verificationStatus === 'REJECTED' ? new Date() : existing.rejectedAt,
    rejectedBy: body.verificationStatus === 'REJECTED' ? auth.userId : existing.rejectedBy,
    updatedBy: auth.userId,
  });

  return c.json({ success: true, data: mapDocumentRow(row) });
}));

app.delete('/:id', withSecurityEvents({ action: 'document.delete', resource: 'document', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  await repos.documents.delete(c.req.param('id'), auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Document deleted' } });
}));

export const documentsHonoRouter = app;
