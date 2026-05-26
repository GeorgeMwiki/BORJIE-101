/**
 * Thin HTTP client for the Google Drive v3 REST API.
 *
 * Every call goes through an injected `Fetcher` port. Production wires
 * `globalThis.fetch`.
 *
 * Reference: Google — "Drive API v3 Reference"
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3
 *   (visited 2026-05-26).
 */

import type {
  Fetcher,
  DriveStartPageTokenResponse,
  DriveChangesResponse,
  DriveUpstreamFile,
  DriveCommentsResponse,
} from '../types.js';

const BASE = 'https://www.googleapis.com/drive/v3';

export interface DriveHttpClient {
  readonly getStartPageToken: (
    accessToken: string,
  ) => Promise<DriveStartPageTokenResponse>;
  readonly listChanges: (
    accessToken: string,
    pageToken: string,
  ) => Promise<DriveChangesResponse>;
  readonly getFile: (
    accessToken: string,
    fileId: string,
  ) => Promise<DriveUpstreamFile>;
  readonly exportText: (
    accessToken: string,
    fileId: string,
  ) => Promise<string>;
  readonly listComments: (
    accessToken: string,
    fileId: string,
  ) => Promise<DriveCommentsResponse>;
}

export interface DriveHttpDeps {
  readonly fetcher: Fetcher;
  readonly baseUrl?: string;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export function createDriveHttpClient(deps: DriveHttpDeps): DriveHttpClient {
  const base = deps.baseUrl ?? BASE;
  return {
    async getStartPageToken(accessToken) {
      const url = new URL(`${base}/changes/startPageToken`);
      url.searchParams.set('supportsAllDrives', 'true');
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: authHeaders(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Drive getStartPageToken failed: ${res.status}`);
      }
      return (await res.json()) as DriveStartPageTokenResponse;
    },
    async listChanges(accessToken, pageToken) {
      const url = new URL(`${base}/changes`);
      url.searchParams.set('pageToken', pageToken);
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set(
        'fields',
        'changes(fileId,removed,time,file(id,name,mimeType,parents,modifiedTime,owners(emailAddress),lastModifyingUser(emailAddress))),newStartPageToken,nextPageToken',
      );
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: authHeaders(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        const err = new Error(`Drive listChanges failed: ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      return (await res.json()) as DriveChangesResponse;
    },
    async getFile(accessToken, fileId) {
      const url = new URL(`${base}/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set(
        'fields',
        'id,name,mimeType,parents,modifiedTime,owners(emailAddress),lastModifyingUser(emailAddress)',
      );
      url.searchParams.set('supportsAllDrives', 'true');
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: authHeaders(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Drive getFile failed: ${res.status}`);
      }
      return (await res.json()) as DriveUpstreamFile;
    },
    async exportText(accessToken, fileId) {
      const url = new URL(`${base}/files/${encodeURIComponent(fileId)}/export`);
      url.searchParams.set('mimeType', 'text/plain');
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: authHeaders(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Drive export failed: ${res.status}`);
      }
      return await res.text();
    },
    async listComments(accessToken, fileId) {
      const url = new URL(`${base}/files/${encodeURIComponent(fileId)}/comments`);
      url.searchParams.set(
        'fields',
        'comments(id,content,author(displayName,emailAddress),modifiedTime)',
      );
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: authHeaders(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Drive listComments failed: ${res.status}`);
      }
      return (await res.json()) as DriveCommentsResponse;
    },
  };
}
