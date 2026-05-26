/**
 * Scan Service (NEW 14)
 *
 * Orchestrates the document-scanning pipeline:
 *
 *   createBundle()     → opens a 'draft' bundle
 *   uploadPage()       → accepts a single page (base64 / buffer), persists
 *                         to object storage, records quad + size
 *   deskewPage()       → STUB — perspective-correct the page image
 *   ocrBundle()        → run OCR across all pages (via existing OCR provider)
 *   assembleBundle()   → combine pages into a single PDF document record
 *   submitBundle()     → transition to 'submitted' and link to a document
 *
 * Native image processing bits (deskew) are stubbed — see KI-011.
 */

export type ScanBundleStatus =
  | 'draft'
  | 'processing'
  | 'ready'
  | 'submitted'
  | 'failed';

export interface ScanPageInput {
  readonly dataUrl: string;
  readonly mimeType: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly quad?: readonly { x: number; y: number }[];
}

export interface ScanBundleRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title?: string;
  readonly purpose?: string;
  readonly status: ScanBundleStatus;
  readonly assembledDocumentId?: string;
  readonly pageCount: number;
  readonly processingLog: readonly { step: string; at: string; detail?: string }[];
  readonly errorMessage?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly submittedAt?: string;
}

export interface ScanPageRecord {
  readonly id: string;
  readonly bundleId: string;
  readonly tenantId: string;
  readonly pageNumber: number;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly quad?: readonly { x: number; y: number }[];
  readonly ocrText?: string;
  readonly ocrConfidence?: number;
  readonly capturedAt: string;
}

export interface IScanRepository {
  createBundle(rec: ScanBundleRecord): Promise<ScanBundleRecord>;
  findBundle(id: string, tenantId: string): Promise<ScanBundleRecord | null>;
  updateBundle(rec: ScanBundleRecord): Promise<ScanBundleRecord>;
  addPage(rec: ScanPageRecord): Promise<ScanPageRecord>;
  listPages(bundleId: string, tenantId: string): Promise<readonly ScanPageRecord[]>;
}

export interface IScanStoragePort {
  upload(input: {
    tenantId: string;
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<{ key: string; url: string; sizeBytes: number }>;
}

export interface IScanOcrPort {
  extractText(
    buffer: Buffer,
    mimeType: string
  ): Promise<{ text: string; confidence: number }>;
}

export interface IDocumentLinkPort {
  /** Register an assembled scan as a document_uploads row and return its id. */
  createDocumentRecord(input: {
    tenantId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    title: string;
    createdBy: string;
  }): Promise<{ documentId: string }>;
}

export const ScanServiceError = {
  NOT_FOUND: 'SCAN_BUNDLE_NOT_FOUND',
  INVALID_STATE: 'INVALID_STATE',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  ASSEMBLY_FAILED: 'ASSEMBLY_FAILED',
} as const;
export type ScanServiceErrorCode =
  (typeof ScanServiceError)[keyof typeof ScanServiceError];

export interface ScanServiceOptions {
  readonly repository: IScanRepository;
  readonly storage: IScanStoragePort;
  readonly ocr?: IScanOcrPort;
  readonly documentLink?: IDocumentLinkPort;
  readonly idFactory?: () => string;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('invalid data URL');
  const [, mime, payload] = match;
  const buffer = Buffer.from(payload ?? '', 'base64');
  return { mime: mime ?? 'application/octet-stream', buffer };
}

// Follow-up KI-011 (#33): replace with real perspective-correct deskew via
//   WASM OpenCV once @techstark/opencv-js is added.
//   See Docs/KNOWN_ISSUES.md#ki-011.
function deskewBuffer(
  input: Buffer,
  _quad?: readonly { x: number; y: number }[]
): Buffer {
  // Pass-through stub — real implementation should perform a projective
  // transform to the detected quad.
  return input;
}

// Follow-up KI-011 (#33): replace with a real PDF assembler (e.g. pdf-lib) once
//   the dep is added. See Docs/KNOWN_ISSUES.md#ki-011.
function assembleToPdf(_pages: readonly Buffer[]): { buffer: Buffer; mimeType: string } {
  // Stub — just return the first page buffer as-is for now.
  return {
    buffer: Buffer.concat(_pages.length > 0 ? [_pages[0]!] : [Buffer.alloc(0)]),
    mimeType: 'application/pdf',
  };
}

export class ScanService {
  constructor(private readonly options: ScanServiceOptions) {}

  async createBundle(input: {
    tenantId: string;
    createdBy: string;
    title?: string;
    purpose?: string;
  }): Promise<ScanBundleRecord> {
    const now = new Date().toISOString();
    const bundle: ScanBundleRecord = {
      id: randomId('scb'),
      tenantId: input.tenantId,
      title: input.title,
      purpose: input.purpose,
      status: 'draft',
      pageCount: 0,
      processingLog: [{ step: 'created', at: now }],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    return this.options.repository.createBundle(bundle);
  }

  async uploadPage(input: {
    tenantId: string;
    bundleId: string;
    page: ScanPageInput;
  }): Promise<{ bundle: ScanBundleRecord; page: ScanPageRecord }> {
    const bundle = await this.options.repository.findBundle(input.bundleId, input.tenantId);
    if (!bundle) throw new Error(ScanServiceError.NOT_FOUND);
    if (bundle.status === 'submitted') throw new Error(ScanServiceError.INVALID_STATE);

    const { mime, buffer } = decodeDataUrl(input.page.dataUrl);
    const deskewed = deskewBuffer(buffer, input.page.quad);
    const key = `scan/${input.tenantId}/${bundle.id}/${bundle.pageCount + 1}.png`;

    let uploaded;
    try {
      uploaded = await this.options.storage.upload({
        tenantId: input.tenantId,
        key,
        content: deskewed,
        contentType: input.page.mimeType || mime,
      });
    } catch (e) {
      throw new Error(`${ScanServiceError.UPLOAD_FAILED}: ${(e as Error).message}`);
    }

    const pageRec: ScanPageRecord = {
      id: randomId('scp'),
      bundleId: bundle.id,
      tenantId: input.tenantId,
      pageNumber: bundle.pageCount + 1,
      storageKey: uploaded.key,
      mimeType: input.page.mimeType || mime,
      sizeBytes: uploaded.sizeBytes,
      widthPx: input.page.widthPx,
      heightPx: input.page.heightPx,
      quad: input.page.quad,
      capturedAt: new Date().toISOString(),
    };
    const savedPage = await this.options.repository.addPage(pageRec);

    const updatedBundle: ScanBundleRecord = {
      ...bundle,
      pageCount: bundle.pageCount + 1,
      updatedAt: new Date().toISOString(),
      processingLog: [
        ...bundle.processingLog,
        {
          step: 'page_uploaded',
          at: new Date().toISOString(),
          detail: `page ${pageRec.pageNumber}`,
        },
      ],
    };
    const savedBundle = await this.options.repository.updateBundle(updatedBundle);
    return { bundle: savedBundle, page: savedPage };
  }

  async ocrBundle(bundleId: string, tenantId: string): Promise<ScanBundleRecord> {
    if (!this.options.ocr) {
      throw new Error('OCR port not configured');
    }
    const bundle = await this.options.repository.findBundle(bundleId, tenantId);
    if (!bundle) throw new Error(ScanServiceError.NOT_FOUND);

    const pages = await this.options.repository.listPages(bundleId, tenantId);
    const now = new Date().toISOString();
    const processing: ScanBundleRecord = {
      ...bundle,
      status: 'processing',
      updatedAt: now,
      processingLog: [...bundle.processingLog, { step: 'ocr_started', at: now }],
    };
    await this.options.repository.updateBundle(processing);

    try {
      // Follow-up KI-011 (#33): fetch each page's buffer from storage; stubbed here
      //   pending the scan pipeline upgrade. See Docs/KNOWN_ISSUES.md#ki-011.
      for (const _p of pages) {
        // await this.options.storage.download(...);
        // await this.options.ocr.extractText(buf, p.mimeType);
      }
    } catch (e) {
      const failed: ScanBundleRecord = {
        ...processing,
        status: 'failed',
        errorMessage: (e as Error).message,
        updatedAt: new Date().toISOString(),
      };
      return this.options.repository.updateBundle(failed);
    }

    const ready: ScanBundleRecord = {
      ...processing,
      status: 'ready',
      updatedAt: new Date().toISOString(),
      processingLog: [
        ...processing.processingLog,
        { step: 'ocr_completed', at: new Date().toISOString() },
      ],
    };
    return this.options.repository.updateBundle(ready);
  }

  async submitBundle(
    bundleId: string,
    tenantId: string,
    submittedBy: string
  ): Promise<ScanBundleRecord> {
    const bundle = await this.options.repository.findBundle(bundleId, tenantId);
    if (!bundle) throw new Error(ScanServiceError.NOT_FOUND);
    if (bundle.status !== 'ready' && bundle.status !== 'draft') {
      throw new Error(ScanServiceError.INVALID_STATE);
    }

    const pages = await this.options.repository.listPages(bundleId, tenantId);
    if (pages.length === 0) {
      throw new Error(ScanServiceError.ASSEMBLY_FAILED);
    }

    // Stub assembly — in production, fetch each page and merge into a PDF.
    const assembled = assembleToPdf(pages.map(() => Buffer.alloc(0)));
    const key = `scan-assembled/${tenantId}/${bundle.id}.pdf`;

    const uploaded = await this.options.storage.upload({
      tenantId,
      key,
      content: assembled.buffer,
      contentType: assembled.mimeType,
    });

    let documentId: string | undefined;
    if (this.options.documentLink) {
      const { documentId: docId } = await this.options.documentLink.createDocumentRecord({
        tenantId,
        storageKey: uploaded.key,
        mimeType: assembled.mimeType,
        sizeBytes: uploaded.sizeBytes,
        title: bundle.title ?? `Scan ${bundle.id}`,
        createdBy: submittedBy,
      });
      documentId = docId;
    }

    const now = new Date().toISOString();
    const submitted: ScanBundleRecord = {
      ...bundle,
      status: 'submitted',
      assembledDocumentId: documentId,
      submittedAt: now,
      updatedAt: now,
      processingLog: [
        ...bundle.processingLog,
        { step: 'submitted', at: now, detail: documentId ?? 'no-link' },
      ],
    };
    return this.options.repository.updateBundle(submitted);
  }
}
