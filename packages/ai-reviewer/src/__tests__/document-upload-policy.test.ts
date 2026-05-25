import { describe, it, expect } from 'vitest';
import { documentUploadPolicy } from '../policies/document-upload-policy.js';
import { makeReq } from './fixtures.js';

describe('documentUploadPolicy', () => {
  it('preChecks reports missing filename/mime/category/bytes', () => {
    const issues = documentUploadPolicy.preChecks(makeReq('document_upload', {}));
    expect(issues.some((i) => i.code === 'document.filename.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'document.mime.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'document.category.missing')).toBe(true);
    expect(issues.some((i) => i.code === 'document.bytes.invalid')).toBe(true);
  });

  it('preChecks rejects unsupported MIME and category', () => {
    const issues = documentUploadPolicy.preChecks(
      makeReq('document_upload', {
        filename: 'x.bin',
        mime: 'application/octet-stream',
        category: 'mysterious',
        bytes: 100,
      }),
    );
    expect(issues.some((i) => i.code === 'document.mime.unsupported')).toBe(true);
    expect(issues.some((i) => i.code === 'document.category.invalid')).toBe(true);
  });

  it('redLines blocks oversized doc', () => {
    const redLines = documentUploadPolicy.redLines(
      makeReq('document_upload', { bytes: 200 * 1024 * 1024 }),
    );
    expect(redLines.some((i) => i.code === 'document.bytes.exceeds_cap')).toBe(true);
  });

  it('redLines blocks MIME/extension mismatch', () => {
    const redLines = documentUploadPolicy.redLines(
      makeReq('document_upload', {
        filename: 'lease.docx',
        mime: 'application/pdf',
        bytes: 1024,
      }),
    );
    expect(redLines.some((i) => i.code === 'document.extension.mismatch')).toBe(true);
  });

  it('redLines blocks executable extension', () => {
    const redLines = documentUploadPolicy.redLines(
      makeReq('document_upload', {
        filename: 'malware.exe',
        mime: 'application/pdf',
        bytes: 1024,
      }),
    );
    expect(redLines.some((i) => i.code === 'document.extension.executable')).toBe(true);
  });
});
