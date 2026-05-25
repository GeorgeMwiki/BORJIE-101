/**
 * Document Domain Events
 * Emitted when significant document actions occur.
 */

import type { TenantId, UserId } from '@borjie/domain-models';
import type { DocumentId, DocumentCategory, DocumentMetadata } from './types.js';

/** Base structure for document events */
interface DocumentEventBase {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Triggered when a document is uploaded */
export interface DocumentUploadedEvent extends DocumentEventBase {
  readonly eventType: 'DocumentUploaded';
  readonly payload: {
    readonly documentId: DocumentId;
    readonly category: DocumentCategory;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    readonly url: string;
    readonly storageKey: string;
    readonly metadata: DocumentMetadata;
    readonly uploadedBy: UserId;
  };
}

/** Triggered when access is granted to a document */
export interface DocumentAccessGrantedEvent extends DocumentEventBase {
  readonly eventType: 'DocumentAccessGranted';
  readonly payload: {
    readonly documentId: DocumentId;
    readonly userId: UserId;
    readonly accessLevel: string;
  };
}

/** Triggered when a document is deleted */
export interface DocumentDeletedEvent extends DocumentEventBase {
  readonly eventType: 'DocumentDeleted';
  readonly payload: {
    readonly documentId: DocumentId;
    readonly category: DocumentCategory;
    readonly deletedBy: UserId;
  };
}

/** Triggered when OCR extraction completes */
export interface DocumentOCRCompletedEvent extends DocumentEventBase {
  readonly eventType: 'DocumentOCRCompleted';
  readonly payload: {
    readonly documentId: DocumentId;
    readonly confidence: number;
    readonly pageCount: number;
    readonly hasStructuredData: boolean;
  };
}

/** Triggered when a document is flagged for potential fraud */
export interface DocumentFraudFlaggedEvent extends DocumentEventBase {
  readonly eventType: 'DocumentFraudFlagged';
  readonly payload: {
    readonly documentId: DocumentId;
    readonly flagCount: number;
    readonly highestSeverity: string;
    readonly flagTypes: readonly string[];
  };
}

/** Triggered when an evidence pack is compiled */
export interface EvidencePackCompiledEvent extends DocumentEventBase {
  readonly eventType: 'EvidencePackCompiled';
  readonly payload: {
    readonly packId: string;
    readonly title: string;
    readonly documentCount: number;
    readonly caseId: string | null;
    readonly leaseId: string | null;
    readonly compiledBy: UserId;
  };
}

export type DocumentEvent =
  | DocumentUploadedEvent
  | DocumentAccessGrantedEvent
  | DocumentDeletedEvent
  | DocumentOCRCompletedEvent
  | DocumentFraudFlaggedEvent
  | EvidencePackCompiledEvent;
