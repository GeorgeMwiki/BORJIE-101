/**
 * Native Google Workspace text extraction.
 *
 * For `application/vnd.google-apps.document`, `.spreadsheet`, and
 * `.presentation`, the canonical text-extraction path is
 * `/v3/files/{id}/export?mimeType=text/plain`. For other mime types
 * (PDF, docx, images) this module returns `null` — those flow through
 * the file-ingest pipeline (`packages/file-ingest`).
 *
 * Reference: Google — "Drive API — Export Google Workspace documents"
 *   https://developers.google.com/workspace/drive/api/guides/manage-downloads#export
 *   (visited 2026-05-26).
 */

import type { DriveHttpClient } from '../client/http-client.js';
import {
  NATIVE_DOC_MIME,
  NATIVE_SHEET_MIME,
  NATIVE_SLIDE_MIME,
} from '../types.js';

export interface ExtractInput {
  readonly accessToken: string;
  readonly fileId: string;
  readonly mimeType: string;
}

export function isNativeWorkspaceMime(mimeType: string): boolean {
  return (
    mimeType === NATIVE_DOC_MIME ||
    mimeType === NATIVE_SHEET_MIME ||
    mimeType === NATIVE_SLIDE_MIME
  );
}

/**
 * Extract plain text via the Drive export endpoint. Returns null for
 * non-native mimes.
 */
export async function extractDriveText(
  input: ExtractInput,
  client: DriveHttpClient,
): Promise<string | null> {
  if (!isNativeWorkspaceMime(input.mimeType)) return null;
  return await client.exportText(input.accessToken, input.fileId);
}
