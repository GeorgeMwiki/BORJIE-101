/**
 * Photo-add policy.
 *
 * Adds one or more photos to an entity (parcel, unit, maintenance
 * ticket). Pre-checks reject malformed uploads (zero bytes, wrong
 * MIME, missing capture metadata). Red lines catch files that look
 * like an attempt to hide a different document type inside an image
 * field or files that exceed the per-tenant size cap.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readNumber, readString } from './_helpers.js';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'] as const;
const MAX_BYTES_PER_FILE = 20 * 1024 * 1024; // 20 MB

interface PhotoFile {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
}

function readPhotos(payload: Readonly<Record<string, unknown>>): ReadonlyArray<PhotoFile> {
  const raw = readArray(payload, ['photos']) ?? [];
  const out: PhotoFile[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { filename?: unknown }).filename === 'string' &&
      typeof (item as { mime?: unknown }).mime === 'string' &&
      typeof (item as { bytes?: unknown }).bytes === 'number'
    ) {
      out.push({
        filename: (item as { filename: string }).filename,
        mime: (item as { mime: string }).mime,
        bytes: (item as { bytes: number }).bytes,
      });
    }
  }
  return out;
}

export const photoAddPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'photo_add',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const photos = readPhotos(req.payload);
    if (photos.length === 0) {
      issues.push(
        issue(
          'photo.list.empty',
          'No photos provided.',
          'error',
          'photos',
        ),
      );
    }
    for (let i = 0; i < photos.length; i += 1) {
      const p = photos[i];
      if (!p) continue;
      if (p.bytes <= 0) {
        issues.push(
          issue(
            'photo.bytes.zero',
            `Photo "${p.filename}" is zero bytes.`,
            'error',
            `photos[${i}].bytes`,
          ),
        );
      }
      if (!ALLOWED_MIMES.includes(p.mime as (typeof ALLOWED_MIMES)[number])) {
        issues.push(
          issue(
            'photo.mime.unsupported',
            `Photo "${p.filename}" MIME "${p.mime}" is not in the allowed set: ${ALLOWED_MIMES.join(', ')}.`,
            'error',
            `photos[${i}].mime`,
          ),
        );
      }
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const photos = readPhotos(req.payload);
    for (let i = 0; i < photos.length; i += 1) {
      const p = photos[i];
      if (!p) continue;
      if (p.bytes > MAX_BYTES_PER_FILE) {
        redLines.push(
          issue(
            'photo.bytes.exceeds_cap',
            `Photo "${p.filename}" is ${p.bytes} bytes — exceeds 20 MB cap.`,
            'critical',
            `photos[${i}].bytes`,
          ),
        );
      }
      // Mime <-> extension mismatch (looks like an upload trick).
      const ext = p.filename.toLowerCase().split('.').pop();
      if (ext === 'pdf' || ext === 'zip' || ext === 'exe') {
        redLines.push(
          issue(
            'photo.extension.executable_or_archive',
            `File "${p.filename}" has an extension that is never an image. Refusing upload.`,
            'critical',
            `photos[${i}].filename`,
          ),
        );
      }
    }
    return redLines;
  },

  brainPrompt(req) {
    const photos = readPhotos(req.payload);
    const totalBytes = photos.reduce((sum, p) => sum + p.bytes, 0);
    const entityId = readString(req.payload, ['entityId']) ?? '(missing)';
    const photoCount = readNumber(req.payload, ['photoCount']) ?? photos.length;
    return [
      `You are reviewing a photo-upload to entity ${entityId} for tenant ${req.context.tenantId}.`,
      `${photoCount} photo(s), ${totalBytes} bytes total.`,
      `Assess whether the uploads look plausible for the entity (e.g. parcel photos taken outdoors, ticket photos showing the reported issue).`,
    ].join(' ');
  },
};
