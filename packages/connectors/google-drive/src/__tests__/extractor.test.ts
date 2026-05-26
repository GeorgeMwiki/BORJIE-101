import { describe, it, expect } from 'vitest';
import {
  extractDriveText,
  isNativeWorkspaceMime,
} from '../extract/text-extractor.js';
import type { DriveHttpClient } from '../client/http-client.js';
import {
  NATIVE_DOC_MIME,
  NATIVE_SHEET_MIME,
  NATIVE_SLIDE_MIME,
} from '../types.js';

function makeClient(exported: string): DriveHttpClient {
  return {
    async getStartPageToken() {
      return { startPageToken: 'X' };
    },
    async listChanges() {
      return {};
    },
    async getFile() {
      throw new Error('not used');
    },
    async exportText() {
      return exported;
    },
    async listComments() {
      return {};
    },
  };
}

describe('extractDriveText', () => {
  it('extracts plain text for native gdoc', async () => {
    const out = await extractDriveText(
      { accessToken: 't', fileId: 'f', mimeType: NATIVE_DOC_MIME },
      makeClient('the doc body'),
    );
    expect(out).toBe('the doc body');
  });

  it('extracts plain text for native gsheet', async () => {
    const out = await extractDriveText(
      { accessToken: 't', fileId: 'f', mimeType: NATIVE_SHEET_MIME },
      makeClient('A1,B1\n1,2'),
    );
    expect(out).toBe('A1,B1\n1,2');
  });

  it('extracts plain text for native gslide', async () => {
    const out = await extractDriveText(
      { accessToken: 't', fileId: 'f', mimeType: NATIVE_SLIDE_MIME },
      makeClient('Slide 1\nSlide 2'),
    );
    expect(out).toBe('Slide 1\nSlide 2');
  });

  it('returns null for non-native mime types (e.g. PDF)', async () => {
    const out = await extractDriveText(
      { accessToken: 't', fileId: 'f', mimeType: 'application/pdf' },
      makeClient('should not be returned'),
    );
    expect(out).toBeNull();
  });

  it('isNativeWorkspaceMime recognises the three native types', () => {
    expect(isNativeWorkspaceMime(NATIVE_DOC_MIME)).toBe(true);
    expect(isNativeWorkspaceMime(NATIVE_SHEET_MIME)).toBe(true);
    expect(isNativeWorkspaceMime(NATIVE_SLIDE_MIME)).toBe(true);
    expect(isNativeWorkspaceMime('application/pdf')).toBe(false);
  });
});
