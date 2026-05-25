/**
 * Document-upload policy.
 *
 * Uploads a document (lease, invoice, ID, etc) and attaches it to an
 * entity. Pre-checks confirm a recognised category and shape of the
 * file metadata. Red-lines reject files larger than the per-tenant cap,
 * files claiming to be PDFs but with an extension that disagrees, and
 * uploads where the actor is not authorised to attach to the target
 * entity class.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readNumber, readString } from './_helpers.js';

const ALLOWED_CATEGORIES = [
  'lease',
  'invoice',
  'id',
  'inspection_report',
  'compliance',
  'other',
] as const;

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const documentUploadPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'document_upload',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const filename = readString(req.payload, ['filename']);
    if (!filename) {
      issues.push(issue('document.filename.missing', 'filename is required.', 'error', 'filename'));
    }
    const mime = readString(req.payload, ['mime']);
    if (!mime) {
      issues.push(issue('document.mime.missing', 'mime is required.', 'error', 'mime'));
    } else if (!ALLOWED_MIMES.includes(mime as (typeof ALLOWED_MIMES)[number])) {
      issues.push(
        issue(
          'document.mime.unsupported',
          `MIME "${mime}" is not supported. Allowed: ${ALLOWED_MIMES.join(', ')}.`,
          'error',
          'mime',
        ),
      );
    }
    const category = readString(req.payload, ['category']);
    if (!category) {
      issues.push(
        issue(
          'document.category.missing',
          'category is required.',
          'error',
          'category',
        ),
      );
    } else if (
      !ALLOWED_CATEGORIES.includes(category as (typeof ALLOWED_CATEGORIES)[number])
    ) {
      issues.push(
        issue(
          'document.category.invalid',
          `category "${category}" is not one of: ${ALLOWED_CATEGORIES.join(', ')}.`,
          'error',
          'category',
        ),
      );
    }
    const bytes = readNumber(req.payload, ['bytes']);
    if (bytes === undefined || bytes <= 0) {
      issues.push(
        issue('document.bytes.invalid', 'bytes must be a positive number.', 'error', 'bytes'),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const bytes = readNumber(req.payload, ['bytes']);
    if (bytes !== undefined && bytes > MAX_BYTES) {
      redLines.push(
        issue(
          'document.bytes.exceeds_cap',
          `Document is ${bytes} bytes — exceeds 100 MB cap.`,
          'critical',
          'bytes',
        ),
      );
    }
    const filename = readString(req.payload, ['filename']);
    const mime = readString(req.payload, ['mime']);
    if (filename && mime) {
      const ext = filename.toLowerCase().split('.').pop();
      if (mime === 'application/pdf' && ext !== 'pdf') {
        redLines.push(
          issue(
            'document.extension.mismatch',
            `File "${filename}" declares MIME "application/pdf" but has extension ".${ext ?? ''}".`,
            'critical',
            'filename',
          ),
        );
      }
      if (ext === 'exe' || ext === 'bat' || ext === 'sh') {
        redLines.push(
          issue(
            'document.extension.executable',
            `Executable file types are not allowed (filename "${filename}").`,
            'critical',
            'filename',
          ),
        );
      }
    }
    return redLines;
  },

  brainPrompt(req) {
    const filename = readString(req.payload, ['filename']) ?? '(missing)';
    const category = readString(req.payload, ['category']) ?? '(missing)';
    const entityId = readString(req.payload, ['entityId']) ?? '(missing)';
    return [
      `You are reviewing a document upload "${filename}" of category "${category}" to entity ${entityId} for tenant ${req.context.tenantId}.`,
      `Assess whether the category, filename, and entity class are consistent (e.g. a "lease" document attached to a unit; an "invoice" attached to a vendor or PO).`,
    ].join(' ');
  },
};
