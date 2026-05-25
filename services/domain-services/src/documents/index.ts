/**
 * Documents / File Management Service
 *
 * Multi-tenant document handling with storage, versioning, sharing, and search.
 *
 * Types:
 *   - DocumentCategory: 'lease' | 'id_document' | 'inspection_report' | 'invoice' | 'receipt' | 'maintenance' | 'legal' | 'other'
 *   - Document: id, tenantId, category, name, mimeType, size, storageKey, url, metadata, uploadedBy, createdAt
 *   - DocumentAccess: documentId, userId, accessLevel, grantedAt
 *
 * Service methods (DocumentService):
 *   - uploadDocument(tenantId, file, category, metadata, uploadedBy)
 *   - getDocument(documentId, tenantId)
 *   - listDocuments(tenantId, filters: {category, propertyId, customerId, leaseId})
 *   - deleteDocument(documentId, tenantId, deletedBy)
 *   - generateSignedUrl(documentId, tenantId, expiresIn)
 *   - grantAccess(documentId, userId, accessLevel)
 *   - revokeAccess(documentId, userId)
 *   - getDocumentsByEntity(entityType, entityId, tenantId)
 *
 * Storage providers (implement StorageProvider):
 *   - LocalStorageProvider (development)
 *   - S3StorageProvider (AWS)
 *   - GCSStorageProvider (Google Cloud)
 *
 * Events:
 *   - DocumentUploadedEvent
 *   - DocumentDeletedEvent
 *   - DocumentAccessGrantedEvent
 */

export * from './types.js';
export * from './events.js';
export * from './document-repository.interface.js';
export * from './document-service.js';
export * from './memory-document-repository.js';
export * from './storage/index.js';
export * from './templates/index.js';
export * from './renderers/index.js';
export * from './letters/index.js';
