/**
 * Evidence Pack Builder Service (Workflow G.7)
 * 
 * Compiles chronological evidence bundles for disputes, legal proceedings, etc.
 * Includes: lease, notices, receipts, inspections, communications
 * Generates PDF with index and integrity hash for legal use.
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  EvidencePackId,
  EvidencePack,
  EvidencePackItem,
  EvidencePackType,
  EvidencePackStatus,
  DocumentUpload,
  DocumentType,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { generateEvidencePackId, generateChecksum } from '../utils/id-generator.js';
import type { IDocumentRepository, IStorageProvider } from './document-collection.service.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IEvidencePackRepository {
  create(pack: EvidencePack): Promise<EvidencePack>;
  findById(id: EvidencePackId, tenantId: TenantId): Promise<EvidencePack | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly EvidencePack[]>;
  findByCase(caseId: string, tenantId: TenantId): Promise<EvidencePack | null>;
  update(pack: EvidencePack): Promise<EvidencePack>;
}

// ============================================================================
// PDF Generator Interface
// ============================================================================

export interface IPDFGenerator {
  generateEvidencePackPDF(params: {
    title: string;
    description: string | null;
    items: readonly {
      documentName: string;
      documentType: string;
      category: string;
      description: string;
      eventDate: string | null;
      pageRange: string | null;
      documentBuffer: Buffer;
    }[];
    timeline: readonly {
      date: string;
      event: string;
    }[];
    metadata: Record<string, unknown>;
  }): Promise<Buffer>;
}

// ============================================================================
// Communication Log Provider Interface
// ============================================================================

export interface ICommunicationLogProvider {
  getMessagesByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    options?: {
      startDate?: string;
      endDate?: string;
    }
  ): Promise<readonly {
    id: string;
    date: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    subject: string | null;
    content: string;
    attachments: readonly string[];
  }[]>;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface EvidencePackBuilderConfig {
  readonly maxDocumentsPerPack: number;
  readonly enableIntegrityHash: boolean;
  readonly defaultStoragePrefix: string;
}

const DEFAULT_CONFIG: EvidencePackBuilderConfig = {
  maxDocumentsPerPack: 100,
  enableIntegrityHash: true,
  defaultStoragePrefix: 'evidence-packs',
};

// ============================================================================
// Evidence Category Mapping
// ============================================================================

const DOCUMENT_CATEGORIES: Record<DocumentType, string> = {
  national_id: 'Identity Documents',
  passport: 'Identity Documents',
  drivers_license: 'Identity Documents',
  utility_bill: 'Proof of Address',
  bank_statement: 'Financial Documents',
  employment_letter: 'Employment Verification',
  payslip: 'Income Verification',
  lease_agreement: 'Lease Documents',
  signed_lease: 'Lease Documents',
  move_in_report: 'Inspection Reports',
  move_out_report: 'Inspection Reports',
  inspection_report: 'Inspection Reports',
  receipt: 'Payment Records',
  invoice: 'Payment Records',
  guarantor_document: 'Guarantor Documents',
  police_clearance: 'Background Checks',
  residence_permit: 'Immigration Documents',
  work_permit: 'Immigration Documents',
  other: 'Other Documents',
};

// ============================================================================
// Evidence Pack Builder Service
// ============================================================================

export interface EvidencePackBuilderServiceOptions {
  readonly documentRepository: IDocumentRepository;
  readonly storageProvider: IStorageProvider;
  readonly evidencePackRepository: IEvidencePackRepository;
  readonly pdfGenerator?: IPDFGenerator;
  readonly communicationLogProvider?: ICommunicationLogProvider;
  readonly config?: Partial<EvidencePackBuilderConfig>;
}

export class EvidencePackBuilderService {
  private readonly documentRepository: IDocumentRepository;
  private readonly storageProvider: IStorageProvider;
  private readonly evidencePackRepository: IEvidencePackRepository;
  private readonly pdfGenerator?: IPDFGenerator;
  private readonly communicationLogProvider?: ICommunicationLogProvider;
  private readonly config: EvidencePackBuilderConfig;

  constructor(options: EvidencePackBuilderServiceOptions) {
    this.documentRepository = options.documentRepository;
    this.storageProvider = options.storageProvider;
    this.evidencePackRepository = options.evidencePackRepository;
    this.pdfGenerator = options.pdfGenerator;
    this.communicationLogProvider = options.communicationLogProvider;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ============================================================================
  // Create Evidence Pack
  // ============================================================================

  async createEvidencePack(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    compiledBy: UserId;
    type: EvidencePackType;
    title: string;
    description?: string;
    caseId?: string;
    leaseId?: string;
    documentIds: readonly DocumentId[];
    includeTimeline?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<ServiceResult<EvidencePack>> {
    const {
      tenantId,
      customerId,
      compiledBy,
      type,
      title,
      description,
      caseId,
      leaseId,
      documentIds,
      includeTimeline = true,
      metadata,
    } = params;

    logger.info('Creating evidence pack', {
      tenantId,
      customerId,
      type,
      documentCount: documentIds.length,
    });

    // Validate document count
    if (documentIds.length > this.config.maxDocumentsPerPack) {
      return err(
        'TOO_MANY_DOCUMENTS',
        `Maximum ${this.config.maxDocumentsPerPack} documents per pack allowed`
      );
    }

    if (documentIds.length === 0) {
      return err('NO_DOCUMENTS', 'At least one document is required');
    }

    // Fetch all documents
    const documents: DocumentUpload[] = [];
    for (const id of documentIds) {
      const doc = await this.documentRepository.findById(id, tenantId);
      if (doc) {
        documents.push(doc);
      } else {
        logger.warn('Document not found for evidence pack', { documentId: id, tenantId });
      }
    }

    if (documents.length === 0) {
      return err('DOCUMENTS_NOT_FOUND', 'None of the specified documents were found');
    }

    const now = new Date().toISOString();

    // Build items list with proper ordering
    const items = this.buildEvidenceItems(documents, compiledBy, now);

    // Build timeline if requested
    const timeline = includeTimeline
      ? await this.buildTimeline(customerId, tenantId, documents)
      : [];

    // Create evidence pack
    const packId = generateEvidencePackId();

    const evidencePack: EvidencePack = {
      id: packId,
      tenantId,
      customerId,
      leaseId: leaseId ?? null,
      caseId: caseId ?? null,
      type,
      title,
      description: description ?? null,
      status: 'compiled',
      items,
      timeline,
      pdfUrl: null,
      pdfGeneratedAt: null,
      integrityHash: null,
      compiledBy,
      compiledAt: now,
      submittedAt: null,
      submittedTo: null,
      metadata: metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const savedPack = await this.evidencePackRepository.create(evidencePack);

    logger.info('Evidence pack created', {
      packId: savedPack.id,
      tenantId,
      customerId,
      itemCount: items.length,
      timelineEvents: timeline.length,
    });

    return ok(savedPack);
  }

  // ============================================================================
  // Generate PDF
  // ============================================================================

  async generatePDF(
    packId: EvidencePackId,
    tenantId: TenantId
  ): Promise<ServiceResult<{ pdfUrl: string; integrityHash: string }>> {
    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    if (!pack) {
      return err('PACK_NOT_FOUND', 'Evidence pack not found');
    }

    if (!this.pdfGenerator) {
      return err('PDF_NOT_SUPPORTED', 'PDF generation is not configured');
    }

    logger.info('Generating evidence pack PDF', {
      packId,
      tenantId,
      itemCount: pack.items.length,
    });

    try {
      // Download all documents
      const itemsWithContent: {
        documentName: string;
        documentType: string;
        category: string;
        description: string;
        eventDate: string | null;
        pageRange: string | null;
        documentBuffer: Buffer;
      }[] = [];

      for (const item of pack.items) {
        const doc = await this.documentRepository.findById(item.documentId, tenantId);
        if (!doc) continue;

        try {
          const content = await this.storageProvider.download(tenantId, doc.storageKey);
          itemsWithContent.push({
            documentName: item.documentName,
            documentType: item.documentType,
            category: item.category,
            description: item.description,
            eventDate: item.eventDate,
            pageRange: item.pageRange,
            documentBuffer: content,
          });
        } catch (error) {
          logger.warn('Failed to download document for PDF', {
            documentId: item.documentId,
            error,
          });
        }
      }

      // Generate PDF
      const pdfBuffer = await this.pdfGenerator.generateEvidencePackPDF({
        title: pack.title,
        description: pack.description,
        items: itemsWithContent,
        timeline: pack.timeline.map(t => ({
          date: t.date,
          event: t.event,
        })),
        metadata: {
          packId: pack.id,
          type: pack.type,
          compiledAt: pack.compiledAt,
          compiledBy: pack.compiledBy,
          customerId: pack.customerId,
          caseId: pack.caseId,
          leaseId: pack.leaseId,
        },
      });

      // Calculate integrity hash
      const integrityHash = this.config.enableIntegrityHash
        ? generateChecksum(pdfBuffer)
        : null;

      // Upload PDF to storage
      const pdfKey = `${this.config.defaultStoragePrefix}/${tenantId}/${pack.id}/evidence-pack.pdf`;
      const uploadResult = await this.storageProvider.upload({
        tenantId,
        key: pdfKey,
        content: pdfBuffer,
        contentType: 'application/pdf',
        metadata: {
          packId: pack.id,
          integrityHash: integrityHash ?? '',
        },
      });

      const now = new Date().toISOString();

      // Update pack with PDF URL
      const updatedPack: EvidencePack = {
        ...pack,
        pdfUrl: uploadResult.url,
        pdfGeneratedAt: now,
        integrityHash,
        updatedAt: now,
      };

      await this.evidencePackRepository.update(updatedPack);

      logger.info('Evidence pack PDF generated', {
        packId,
        tenantId,
        pdfUrl: uploadResult.url,
        integrityHash,
      });

      return ok({
        pdfUrl: uploadResult.url,
        integrityHash: integrityHash ?? '',
      });
    } catch (error) {
      logger.error('Failed to generate evidence pack PDF', {
        packId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return err('PDF_GENERATION_FAILED', 'Failed to generate PDF');
    }
  }

  // ============================================================================
  // Quick Evidence Pack Generation
  // ============================================================================

  async generateQuickPack(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    compiledBy: UserId;
    type: EvidencePackType;
    title?: string;
    caseId?: string;
    leaseId?: string;
    dateRange?: {
      startDate: string;
      endDate: string;
    };
  }): Promise<ServiceResult<EvidencePack>> {
    const {
      tenantId,
      customerId,
      compiledBy,
      type,
      title,
      caseId,
      leaseId,
      dateRange,
    } = params;

    // Get all customer documents
    const allDocuments = await this.documentRepository.findByCustomer(customerId, tenantId);

    // Filter by date range if specified
    let filteredDocuments = [...allDocuments];
    if (dateRange) {
      const startDate = new Date(dateRange.startDate);
      const endDate = new Date(dateRange.endDate);
      filteredDocuments = filteredDocuments.filter(d => {
        const docDate = new Date(d.uploadedAt);
        return docDate >= startDate && docDate <= endDate;
      });
    }

    // Filter by type-specific documents
    const relevantDocuments = this.filterDocumentsByPackType(filteredDocuments, type);

    if (relevantDocuments.length === 0) {
      return err('NO_RELEVANT_DOCUMENTS', 'No relevant documents found for this pack type');
    }

    // Generate default title if not provided
    const packTitle = title ?? this.generatePackTitle(type, customerId);

    return this.createEvidencePack({
      tenantId,
      customerId,
      compiledBy,
      type,
      title: packTitle,
      description: `Auto-generated evidence pack for ${type.replace('_', ' ')}`,
      caseId,
      leaseId,
      documentIds: relevantDocuments.map(d => d.id),
      includeTimeline: true,
    });
  }

  // ============================================================================
  // Add/Remove Items
  // ============================================================================

  async addItem(params: {
    packId: EvidencePackId;
    tenantId: TenantId;
    documentId: DocumentId;
    description?: string;
    eventDate?: string;
    addedBy: UserId;
  }): Promise<ServiceResult<EvidencePack>> {
    const { packId, tenantId, documentId, description, eventDate, addedBy } = params;

    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    if (!pack) {
      return err('PACK_NOT_FOUND', 'Evidence pack not found');
    }

    if (pack.status === 'submitted' || pack.status === 'archived') {
      return err('PACK_LOCKED', 'Cannot modify submitted or archived pack');
    }

    const document = await this.documentRepository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    // Check if already in pack
    if (pack.items.some(i => i.documentId === documentId)) {
      return err('ALREADY_IN_PACK', 'Document is already in the pack');
    }

    const now = new Date().toISOString();

    const newItem: EvidencePackItem = {
      documentId,
      documentName: document.originalFileName,
      documentType: document.documentType,
      category: DOCUMENT_CATEGORIES[document.documentType] ?? 'Other Documents',
      description: description ?? document.originalFileName,
      eventDate: eventDate ?? document.uploadedAt,
      addedAt: now,
      addedBy,
      sortOrder: pack.items.length + 1,
      pageRange: null,
    };

    const updatedPack: EvidencePack = {
      ...pack,
      items: [...pack.items, newItem],
      pdfUrl: null, // Invalidate existing PDF
      pdfGeneratedAt: null,
      integrityHash: null,
      updatedAt: now,
    };

    const saved = await this.evidencePackRepository.update(updatedPack);
    return ok(saved);
  }

  async removeItem(params: {
    packId: EvidencePackId;
    tenantId: TenantId;
    documentId: DocumentId;
  }): Promise<ServiceResult<EvidencePack>> {
    const { packId, tenantId, documentId } = params;

    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    if (!pack) {
      return err('PACK_NOT_FOUND', 'Evidence pack not found');
    }

    if (pack.status === 'submitted' || pack.status === 'archived') {
      return err('PACK_LOCKED', 'Cannot modify submitted or archived pack');
    }

    const itemIndex = pack.items.findIndex(i => i.documentId === documentId);
    if (itemIndex === -1) {
      return err('ITEM_NOT_FOUND', 'Document not found in pack');
    }

    const now = new Date().toISOString();

    // Remove item and reorder
    const newItems = pack.items
      .filter(i => i.documentId !== documentId)
      .map((item, index) => ({ ...item, sortOrder: index + 1 }));

    const updatedPack: EvidencePack = {
      ...pack,
      items: newItems,
      pdfUrl: null,
      pdfGeneratedAt: null,
      integrityHash: null,
      updatedAt: now,
    };

    const saved = await this.evidencePackRepository.update(updatedPack);
    return ok(saved);
  }

  // ============================================================================
  // Status Management
  // ============================================================================

  async submitPack(params: {
    packId: EvidencePackId;
    tenantId: TenantId;
    submittedTo: string;
    submittedBy: UserId;
  }): Promise<ServiceResult<EvidencePack>> {
    const { packId, tenantId, submittedTo, submittedBy } = params;

    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    if (!pack) {
      return err('PACK_NOT_FOUND', 'Evidence pack not found');
    }

    if (pack.status === 'archived') {
      return err('PACK_ARCHIVED', 'Cannot submit archived pack');
    }

    // Generate PDF if not exists
    if (!pack.pdfUrl) {
      const pdfResult = await this.generatePDF(packId, tenantId);
      if (!pdfResult.success) {
        return err('PDF_REQUIRED', 'Failed to generate PDF before submission');
      }
    }

    const now = new Date().toISOString();

    const updatedPack: EvidencePack = {
      ...pack,
      status: 'submitted',
      submittedAt: now,
      submittedTo,
      updatedAt: now,
    };

    const saved = await this.evidencePackRepository.update(updatedPack);

    logger.info('Evidence pack submitted', {
      packId,
      tenantId,
      submittedTo,
      submittedBy,
    });

    return ok(saved);
  }

  async archivePack(
    packId: EvidencePackId,
    tenantId: TenantId
  ): Promise<ServiceResult<EvidencePack>> {
    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    if (!pack) {
      return err('PACK_NOT_FOUND', 'Evidence pack not found');
    }

    const now = new Date().toISOString();

    const updatedPack: EvidencePack = {
      ...pack,
      status: 'archived',
      updatedAt: now,
    };

    const saved = await this.evidencePackRepository.update(updatedPack);
    return ok(saved);
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  async getEvidencePack(
    packId: EvidencePackId,
    tenantId: TenantId
  ): Promise<ServiceResult<EvidencePack | null>> {
    const pack = await this.evidencePackRepository.findById(packId, tenantId);
    return ok(pack);
  }

  async getCustomerPacks(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly EvidencePack[]>> {
    const packs = await this.evidencePackRepository.findByCustomer(customerId, tenantId);
    return ok(packs);
  }

  async getCasePack(
    caseId: string,
    tenantId: TenantId
  ): Promise<ServiceResult<EvidencePack | null>> {
    const pack = await this.evidencePackRepository.findByCase(caseId, tenantId);
    return ok(pack);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private buildEvidenceItems(
    documents: readonly DocumentUpload[],
    addedBy: UserId,
    timestamp: string
  ): readonly EvidencePackItem[] {
    // Sort by upload date
    const sorted = [...documents].sort(
      (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
    );

    return sorted.map((doc, index) => ({
      documentId: doc.id,
      documentName: doc.originalFileName,
      documentType: doc.documentType,
      category: DOCUMENT_CATEGORIES[doc.documentType] ?? 'Other Documents',
      description: doc.originalFileName,
      eventDate: doc.uploadedAt,
      addedAt: timestamp,
      addedBy,
      sortOrder: index + 1,
      pageRange: null,
    }));
  }

  private async buildTimeline(
    customerId: CustomerId,
    tenantId: TenantId,
    documents: readonly DocumentUpload[]
  ): Promise<readonly { date: string; event: string; documentIds: readonly DocumentId[] }[]> {
    const events: { date: string; event: string; documentIds: DocumentId[] }[] = [];

    // Add document events
    for (const doc of documents) {
      events.push({
        date: doc.uploadedAt,
        event: `${doc.documentType.replace('_', ' ')} uploaded`,
        documentIds: [doc.id],
      });
    }

    // Add communication events if provider available
    if (this.communicationLogProvider) {
      try {
        const messages = await this.communicationLogProvider.getMessagesByCustomer(
          customerId,
          tenantId
        );

        for (const msg of messages) {
          events.push({
            date: msg.date,
            event: `${msg.direction === 'inbound' ? 'Received' : 'Sent'} ${msg.channel} message: ${msg.subject ?? msg.content.substring(0, 50)}...`,
            documentIds: [],
          });
        }
      } catch (error) {
        logger.warn('Failed to fetch communication logs for timeline', { error });
      }
    }

    // Sort by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return events;
  }

  private filterDocumentsByPackType(
    documents: readonly DocumentUpload[],
    type: EvidencePackType
  ): readonly DocumentUpload[] {
    const typeFilters: Record<EvidencePackType, DocumentType[]> = {
      dispute_resolution: ['lease_agreement', 'signed_lease', 'receipt', 'invoice', 'inspection_report', 'move_in_report', 'move_out_report'],
      eviction: ['lease_agreement', 'signed_lease', 'receipt', 'invoice', 'inspection_report'],
      deposit_settlement: ['lease_agreement', 'move_in_report', 'move_out_report', 'inspection_report', 'receipt'],
      insurance_claim: ['inspection_report', 'receipt', 'invoice'],
      legal_proceeding: ['national_id', 'passport', 'lease_agreement', 'signed_lease', 'receipt', 'invoice', 'inspection_report'],
      compliance_audit: ['national_id', 'passport', 'lease_agreement', 'signed_lease', 'employment_letter', 'payslip'],
      tenant_offboarding: ['move_out_report', 'inspection_report', 'receipt'],
      general: [], // Include all
    };

    const allowedTypes = typeFilters[type];

    if (allowedTypes.length === 0) {
      return documents; // Return all for 'general'
    }

    return documents.filter(d => allowedTypes.includes(d.documentType));
  }

  private generatePackTitle(type: EvidencePackType, customerId: CustomerId): string {
    const typeNames: Record<EvidencePackType, string> = {
      dispute_resolution: 'Dispute Resolution',
      eviction: 'Eviction',
      deposit_settlement: 'Deposit Settlement',
      insurance_claim: 'Insurance Claim',
      legal_proceeding: 'Legal Proceeding',
      compliance_audit: 'Compliance Audit',
      tenant_offboarding: 'Tenant Offboarding',
      general: 'General',
    };

    const date = new Date().toISOString().split('T')[0];
    return `${typeNames[type]} Evidence Pack - ${date}`;
  }
}

// ============================================================================
// Mock PDF Generator (for testing)
// ============================================================================

export class MockPDFGenerator implements IPDFGenerator {
  async generateEvidencePackPDF(params: {
    title: string;
    description: string | null;
    items: readonly {
      documentName: string;
      documentType: string;
      category: string;
      description: string;
      eventDate: string | null;
      pageRange: string | null;
      documentBuffer: Buffer;
    }[];
    timeline: readonly { date: string; event: string }[];
    metadata: Record<string, unknown>;
  }): Promise<Buffer> {
    // Create a simple mock PDF (in production, use pdfkit or similar)
    const content = `
EVIDENCE PACK
=============
Title: ${params.title}
${params.description ? `Description: ${params.description}` : ''}
Generated: ${new Date().toISOString()}

TABLE OF CONTENTS
-----------------
${params.items.map((item, i) => `${i + 1}. ${item.documentName} (${item.category})`).join('\n')}

TIMELINE
--------
${params.timeline.map(t => `${t.date}: ${t.event}`).join('\n')}

METADATA
--------
${JSON.stringify(params.metadata, null, 2)}
    `;

    return Buffer.from(content, 'utf-8');
  }
}
