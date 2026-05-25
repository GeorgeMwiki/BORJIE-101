/**
 * In-Memory Document Repository
 * For development and testing - multi-tenant isolation enforced.
 */

import type { TenantId, UserId, PaginationParams, PaginatedResult } from '@borjie/domain-models';
import type {
  Document,
  DocumentId,
  DocumentAccess,
  DocumentVersion,
  DocumentFilters,
} from './types.js';
import type { DocumentRepository } from './document-repository.interface.js';

export class MemoryDocumentRepository implements DocumentRepository {
  private readonly documents = new Map<string, Document>();
  private readonly versions = new Map<string, DocumentVersion[]>();
  private readonly accessRecords = new Map<string, DocumentAccess[]>();

  private key(id: DocumentId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  private accessKey(documentId: DocumentId, userId: UserId): string {
    return `${documentId}:${userId}`;
  }

  async findById(id: DocumentId, tenantId: TenantId): Promise<Document | null> {
    return this.documents.get(this.key(id, tenantId)) ?? null;
  }

  async findMany(
    tenantId: TenantId,
    filters: DocumentFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Document>> {
    const params = pagination ?? { limit: 50, offset: 0 };
    let items = Array.from(this.documents.values()).filter(
      (d) => d.tenantId === tenantId
    );

    if (filters.category) {
      items = items.filter((d) => d.category === filters.category);
    }
    if (filters.propertyId) {
      items = items.filter((d) => d.propertyId === filters.propertyId);
    }
    if (filters.customerId) {
      items = items.filter((d) => d.customerId === filters.customerId);
    }
    if (filters.leaseId) {
      items = items.filter((d) => d.leaseId === filters.leaseId);
    }
    if (filters.entityType) {
      items = items.filter((d) => d.entityType === filters.entityType);
    }
    if (filters.entityId) {
      items = items.filter((d) => d.entityId === filters.entityId);
    }
    if (filters.tags?.length) {
      const tags = filters.tags;
      items = items.filter((d) => {
        const docTags = (d.metadata?.tags as string[] | undefined) ?? [];
        return tags.some((t) => docTags.includes(t));
      });
    }
    if (filters.createdAfter) {
      items = items.filter((d) => d.createdAt >= filters.createdAfter!);
    }
    if (filters.createdBefore) {
      items = items.filter((d) => d.createdAt <= filters.createdBefore!);
    }
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      items = items.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.metadata?.tags as string[] | undefined)?.some((t) =>
            String(t).toLowerCase().includes(q)
          )
      );
    }

    const total = items.length;
    const slice = items.slice(params.offset, params.offset + params.limit);

    return {
      items: slice,
      total,
      limit: params.limit,
      offset: params.offset,
      hasMore: params.offset + slice.length < total,
    };
  }

  async findByEntity(
    entityType: string,
    entityId: string,
    tenantId: TenantId
  ): Promise<readonly Document[]> {
    return Array.from(this.documents.values()).filter(
      (d) =>
        d.tenantId === tenantId &&
        d.entityType === entityType &&
        d.entityId === entityId
    );
  }

  async search(tenantId: TenantId, query: string): Promise<readonly Document[]> {
    const q = query.toLowerCase();
    return Array.from(this.documents.values()).filter(
      (d) =>
        d.tenantId === tenantId &&
        (d.name.toLowerCase().includes(q) ||
          (d.metadata?.tags as string[] | undefined)?.some((t) =>
            String(t).toLowerCase().includes(q)
          ) ||
          d.entityId?.toLowerCase().includes(q))
    );
  }

  async create(document: Document): Promise<Document> {
    this.documents.set(this.key(document.id, document.tenantId), document);
    return document;
  }

  async update(document: Document): Promise<Document> {
    this.documents.set(this.key(document.id, document.tenantId), document);
    return document;
  }

  async delete(id: DocumentId, tenantId: TenantId): Promise<void> {
    this.documents.delete(this.key(id, tenantId));
    this.versions.delete(`${tenantId}:${id}`);
    this.accessRecords.delete(`${tenantId}:${id}`);
  }

  async findByIds(
    ids: readonly DocumentId[],
    tenantId: TenantId
  ): Promise<readonly Document[]> {
    const idSet = new Set(ids);
    return Array.from(this.documents.values()).filter(
      (d) => d.tenantId === tenantId && idSet.has(d.id)
    );
  }

  async createVersion(version: DocumentVersion): Promise<DocumentVersion> {
    const key = `${version.tenantId}:${version.documentId}`;
    const list = this.versions.get(key) ?? [];
    list.push(version);
    this.versions.set(key, list);
    return version;
  }

  async findVersions(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<readonly DocumentVersion[]> {
    const key = `${tenantId}:${documentId}`;
    const list = this.versions.get(key) ?? [];
    return [...list].sort((a, b) => a.version - b.version);
  }

  async getLatestVersion(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<DocumentVersion | null> {
    const key = `${tenantId}:${documentId}`;
    const list = this.versions.get(key) ?? [];
    if (list.length === 0) return null;
    return [...list].sort((a, b) => b.version - a.version)[0];
  }

  async addAccess(access: DocumentAccess): Promise<DocumentAccess> {
    const doc = Array.from(this.documents.values()).find((d) => d.id === access.documentId);
    const tenantId = access.tenantId ?? doc?.tenantId;
    if (!tenantId) throw new Error('Document not found or tenantId required for access grant');
    const key = `${tenantId}:${access.documentId}`;
    const list = this.accessRecords.get(key) ?? [];
    const record = { ...access, id: access.id ?? `acc_${access.documentId}_${access.userId}_${Date.now()}`, tenantId };
    list.push(record);
    this.accessRecords.set(key, list);
    return record;
  }

  async removeAccess(documentId: DocumentId, userId: UserId): Promise<void> {
    const docs = Array.from(this.documents.values()).filter((d) => d.id === documentId);
    for (const doc of docs) {
      const key = `${doc.tenantId}:${documentId}`;
      const list = this.accessRecords.get(key) ?? [];
      const filtered = list.filter((a) => a.userId !== userId);
      if (filtered.length === 0) {
        this.accessRecords.delete(key);
      } else {
        this.accessRecords.set(key, filtered);
      }
    }
  }

  async findAccess(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<readonly DocumentAccess[]> {
    return this.accessRecords.get(`${tenantId}:${documentId}`) ?? [];
  }
}
