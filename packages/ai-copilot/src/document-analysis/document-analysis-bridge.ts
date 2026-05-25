/**
 * Document Analysis Bridge — connects the uploaded-document pipeline to
 * the AI Professor.
 *
 * When an operator uploads a document through the scans router or LPMS
 * connector, the bridge:
 *   1. Classifies the document kind.
 *   2. Extracts structured fields via the per-kind parser.
 *   3. Spawns an analysis "agent" (function call) that summarises + links
 *      the extracted data to domain entities (lease -> unit, invoice ->
 *      work order).
 *   4. Emits an analysis envelope the caller stores on the document.
 *
 * The bridge is deliberately storage-agnostic. Persistence is the caller's
 * responsibility — the bridge only computes the envelope.
 */

import { z } from 'zod';
import {
  analyzeDocument,
  classifyDocument,
  DocumentAnalysisResult,
  DocumentKind,
} from './document-intelligence.js';

export const DocumentUploadSchema = z.object({
  tenantId: z.string().min(1),
  documentId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  text: z.string().min(1),
  uploadedBy: z.string().min(1),
  uploadedAt: z.string().datetime().default(() => new Date().toISOString()),
  hintedKind: z
    .enum([
      'lease_agreement',
      'rent_roll',
      'tenant_application',
      'maintenance_invoice',
      'compliance_notice',
      'government_letter',
      'unknown',
    ])
    .optional(),
  countryCode: z.string().length(2).optional(),
});
export type DocumentUpload = z.infer<typeof DocumentUploadSchema>;

export interface AnalysisEnvelope {
  readonly tenantId: string;
  readonly documentId: string;
  readonly classifiedKind: DocumentKind;
  readonly classificationConfidence: number;
  readonly analysis: DocumentAnalysisResult;
  readonly suggestedLinks: readonly SuggestedLink[];
  readonly summary: string;
  readonly analyzedAt: string;
}

export interface SuggestedLink {
  readonly entityType: 'unit' | 'property' | 'lease' | 'tenant' | 'work_order' | 'invoice';
  readonly reason: string;
  readonly hintedIdentifier?: string;
}

export function analyzeUpload(upload: DocumentUpload): AnalysisEnvelope {
  const parsed = DocumentUploadSchema.parse(upload);
  const effectiveKind = parsed.hintedKind ?? classifyDocument(parsed.text).kind;
  const classification = parsed.hintedKind
    ? { kind: parsed.hintedKind, confidence: 1 }
    : classifyDocument(parsed.text);
  const analysis = analyzeDocument(parsed.text);
  const suggestedLinks = buildSuggestedLinks(effectiveKind, analysis);
  const summary = buildSummary(effectiveKind, analysis);

  return {
    tenantId: parsed.tenantId,
    documentId: parsed.documentId,
    classifiedKind: effectiveKind,
    classificationConfidence: classification.confidence,
    analysis,
    suggestedLinks,
    summary,
    analyzedAt: new Date().toISOString(),
  };
}

function buildSuggestedLinks(
  kind: DocumentKind,
  analysis: DocumentAnalysisResult
): readonly SuggestedLink[] {
  const links: SuggestedLink[] = [];
  const ex = analysis.extracted;
  switch (kind) {
    case 'lease_agreement':
      if (typeof ex.tenant === 'string')
        links.push({ entityType: 'tenant', reason: 'tenant named in lease', hintedIdentifier: ex.tenant });
      links.push({ entityType: 'lease', reason: 'new lease document' });
      links.push({ entityType: 'unit', reason: 'lease attaches to a unit' });
      break;
    case 'rent_roll':
      links.push({ entityType: 'property', reason: 'rent roll summarises property-level rentals' });
      break;
    case 'tenant_application':
      if (typeof ex.applicantName === 'string')
        links.push({ entityType: 'tenant', reason: 'applicant record', hintedIdentifier: ex.applicantName });
      break;
    case 'maintenance_invoice':
      links.push({ entityType: 'work_order', reason: 'invoice settles a work order' });
      links.push({ entityType: 'invoice', reason: 'invoice record' });
      break;
    case 'compliance_notice':
      if (typeof ex.partyServed === 'string')
        links.push({ entityType: 'tenant', reason: 'notice served to tenant', hintedIdentifier: ex.partyServed });
      break;
    case 'government_letter':
      links.push({ entityType: 'property', reason: 'government letter usually references a property' });
      break;
    case 'unknown':
      break;
  }
  return links;
}

function buildSummary(kind: DocumentKind, analysis: DocumentAnalysisResult): string {
  const flags =
    analysis.flags.length > 0 ? ` Flags: ${analysis.flags.join(', ')}.` : '';
  const preview = Object.entries(analysis.extracted)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return `Identified as ${kind.replace(/_/g, ' ')} (confidence ${Math.round(analysis.confidence * 100)}%).${preview ? ' ' + preview + '.' : ''}${flags}`;
}
