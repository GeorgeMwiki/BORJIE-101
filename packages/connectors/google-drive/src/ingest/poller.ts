/**
 * Google Drive change-feed poller.
 *
 * On first run, calls /v3/changes/startPageToken and stores the token.
 * Every subsequent run pages through /v3/changes?pageToken={token}. For
 * each non-removed change, fetches the file metadata and (for native
 * gdoc/sheet/slide) exports plain text.
 *
 * Reference: Google — "Drive API — Track changes for users"
 *   https://developers.google.com/workspace/drive/api/guides/manage-changes
 *   (visited 2026-05-26).
 *
 * On 404 (token expiry after ~7 days inactivity), the caller is
 * expected to reset the cursor via getStartPageToken. The poller
 * surfaces a typed `cursor-expired` outcome so the orchestrator can
 * handle it.
 */

import type {
  DriveFile,
  ConnectorLogger,
} from '../types.js';
import type { DriveHttpClient } from '../client/http-client.js';
import { normalizeDriveFile, type DriveNormalizerDeps } from './normalizer.js';
import { extractDriveText } from '../extract/text-extractor.js';

export interface DrivePollInput {
  readonly tenantId: string;
  readonly account: string;
  readonly accessToken: string;
  readonly pageToken: string | null;
  readonly maxItems: number;
}

export interface DrivePollDeps {
  readonly client: DriveHttpClient;
  readonly logger: ConnectorLogger;
  readonly nowIso: () => string;
  readonly uuid: () => string;
}

export type DrivePollOutcome =
  | {
      readonly kind: 'ok';
      readonly rows: ReadonlyArray<DriveFile>;
      readonly nextPageToken: string;
      readonly redactedFieldsPerRow: ReadonlyArray<ReadonlyArray<string>>;
    }
  | { readonly kind: 'cursor-expired' }
  | { readonly kind: 'auth-failed'; readonly status: number }
  | { readonly kind: 'transport-error'; readonly message: string };

export async function pollDriveChanges(
  input: DrivePollInput,
  deps: DrivePollDeps,
): Promise<DrivePollOutcome> {
  let pageToken = input.pageToken;
  if (!pageToken) {
    try {
      const start = await deps.client.getStartPageToken(input.accessToken);
      pageToken = start.startPageToken;
      return {
        kind: 'ok',
        rows: [],
        nextPageToken: pageToken,
        redactedFieldsPerRow: [],
      };
    } catch (e) {
      return {
        kind: 'transport-error',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const normalizerDeps: DriveNormalizerDeps = {
    tenantId: input.tenantId,
    account: input.account,
    nowIso: deps.nowIso,
    uuid: deps.uuid,
  };

  const rows: DriveFile[] = [];
  const redactedFieldsPerRow: ReadonlyArray<string>[] = [];

  let token: string | null = pageToken;
  for (let iter = 0; iter < 50 && rows.length < input.maxItems; iter += 1) {
    if (!token) break;
    let resp: Awaited<ReturnType<DriveHttpClient['listChanges']>>;
    try {
      resp = await deps.client.listChanges(input.accessToken, token);
    } catch (e) {
      const errWithStatus = e as Error & { status?: number };
      if (errWithStatus.status === 404) return { kind: 'cursor-expired' };
      if (errWithStatus.status === 401 || errWithStatus.status === 403) {
        return { kind: 'auth-failed', status: errWithStatus.status };
      }
      return {
        kind: 'transport-error',
        message: errWithStatus.message,
      };
    }
    const changes = resp.changes ?? [];
    for (const change of changes) {
      if (change.removed === true) continue;
      const fileInfo = change.file;
      if (!fileInfo) continue;
      let extractedText: string | null = null;
      try {
        extractedText = await extractDriveText(
          {
            accessToken: input.accessToken,
            fileId: fileInfo.id,
            mimeType: fileInfo.mimeType,
          },
          deps.client,
        );
      } catch (e) {
        deps.logger.warn('Drive text extract failed; persisting metadata only', {
          persona: 'Mr. Mwikila',
          connector: 'google-drive',
          tenantId: input.tenantId,
          fileId: fileInfo.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
      const normalised = normalizeDriveFile(fileInfo, extractedText, normalizerDeps);
      rows.push(normalised.row);
      redactedFieldsPerRow.push(normalised.redactedFields);
      if (rows.length >= input.maxItems) break;
    }
    if (resp.newStartPageToken) {
      token = resp.newStartPageToken;
      break;
    }
    if (resp.nextPageToken) {
      token = resp.nextPageToken;
    } else {
      break;
    }
  }

  return {
    kind: 'ok',
    rows,
    nextPageToken: token ?? pageToken,
    redactedFieldsPerRow,
  };
}
