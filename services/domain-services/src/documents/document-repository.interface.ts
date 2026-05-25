/**
 * Document Repository Interface
 * Data access for documents with multi-tenant isolation.
 */

import type { TenantId, UserId, PaginationParams, PaginatedResult } from '@borjie/domain-models';
import type {
  Document,
  DocumentId,
  DocumentAccess,
  DocumentVersion,
  DocumentFilters,
} from './types.js';

export interface DocumentRepository {
  findById(id: DocumentId, tenantId: TenantId): Promise<Document | null>;
  findMany(
    tenantId: TenantId,
    filters: DocumentFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Document>>;
  findByEntity(
    entityType: string,
    entityId: string,
    tenantId: TenantId
  ): Promise<readonly Document[]>;
  findByIds(
    ids: readonly DocumentId[],
    tenantId: TenantId
  ): Promise<readonly Document[]>;
  search(tenantId: TenantId, query: string): Promise<readonly Document[]>;
  create(document: Document): Promise<Document>;
  update(document: Document): Promise<Document>;
  delete(id: DocumentId, tenantId: TenantId): Promise<void>;
  createVersion?(version: DocumentVersion): Promise<DocumentVersion>;
  findVersions?(documentId: DocumentId, tenantId: TenantId): Promise<readonly DocumentVersion[]>;
  getLatestVersion?(documentId: DocumentId, tenantId: TenantId): Promise<DocumentVersion | null>;
  addAccess(access: DocumentAccess): Promise<DocumentAccess>;
  removeAccess(documentId: DocumentId, userId: UserId): Promise<void>;
  findAccess(documentId: DocumentId, tenantId: TenantId): Promise<readonly DocumentAccess[]>;
}
