/**
 * Tests for the bucket / path conventions shared across all adapters.
 */

import { describe, it, expect } from 'vitest';
import {
  tenantScopedPath,
  tenantIdFromPath,
  physicalBucketName,
  STANDARD_BUCKETS,
} from '../types.js';

describe('tenantScopedPath', () => {
  it('joins tenant + file with a single slash', () => {
    expect(tenantScopedPath('tenant-1', 'file.pdf')).toBe('tenant-1/file.pdf');
  });

  it('normalises a leading slash on fileId', () => {
    expect(tenantScopedPath('tenant-1', '/folder/file.pdf')).toBe(
      'tenant-1/folder/file.pdf',
    );
  });

  it('rejects a tenantId containing a slash', () => {
    expect(() => tenantScopedPath('tenant/oops', 'file.pdf')).toThrow();
  });

  it('rejects an empty tenantId', () => {
    expect(() => tenantScopedPath('', 'file.pdf')).toThrow();
  });

  it('rejects an empty fileId', () => {
    expect(() => tenantScopedPath('tenant-1', '')).toThrow();
  });
});

describe('tenantIdFromPath', () => {
  it('extracts tenant id from canonical path', () => {
    expect(tenantIdFromPath('tenant-1/folder/file.pdf')).toBe('tenant-1');
  });

  it('returns null for a path with no tenant segment', () => {
    expect(tenantIdFromPath('file.pdf')).toBe(null);
  });

  it('returns null for empty leading segment', () => {
    expect(tenantIdFromPath('/file.pdf')).toBe(null);
  });
});

describe('physicalBucketName', () => {
  it('prefixes logical bucket with borjie-<env>-', () => {
    expect(physicalBucketName('documents', 'staging')).toBe(
      'borjie-staging-documents',
    );
  });

  it('throws on missing environment', () => {
    expect(() => physicalBucketName('documents', '')).toThrow();
  });
});

describe('STANDARD_BUCKETS', () => {
  it('contains the seven canonical buckets', () => {
    expect(STANDARD_BUCKETS).toEqual([
      'documents',
      'media-photos',
      'media-videos',
      'media-audio',
      'reports',
      'avatars',
      'tenant-uploads',
    ]);
  });
});
