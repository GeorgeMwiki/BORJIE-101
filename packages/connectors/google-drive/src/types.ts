/**
 * @borjie/connector-google-drive — domain types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §5.
 */

export const PROVIDER = 'google-drive' as const;
export type Provider = typeof PROVIDER;

export const NATIVE_DOC_MIME = 'application/vnd.google-apps.document' as const;
export const NATIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet' as const;
export const NATIVE_SLIDE_MIME = 'application/vnd.google-apps.presentation' as const;

export type NativeMimeType =
  | typeof NATIVE_DOC_MIME
  | typeof NATIVE_SHEET_MIME
  | typeof NATIVE_SLIDE_MIME;

/** One canonical row in `drive_files`. */
export interface DriveFile {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly fileId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: ReadonlyArray<string>;
  readonly modifiedAt: string;
  readonly extractedText: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

/** Drive `files/{id}` response (partial — only fields we read). */
export interface DriveUpstreamFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents?: ReadonlyArray<string>;
  readonly modifiedTime: string;
  readonly owners?: ReadonlyArray<{ readonly emailAddress?: string }>;
  readonly lastModifyingUser?: { readonly emailAddress?: string };
}

export interface DriveChangeRow {
  readonly fileId?: string;
  readonly removed?: boolean;
  readonly time?: string;
  readonly file?: DriveUpstreamFile;
}

export interface DriveChangesResponse {
  readonly changes?: ReadonlyArray<DriveChangeRow>;
  readonly newStartPageToken?: string;
  readonly nextPageToken?: string;
}

export interface DriveStartPageTokenResponse {
  readonly startPageToken: string;
}

export interface DriveCommentsResponse {
  readonly comments?: ReadonlyArray<{
    readonly id?: string;
    readonly content?: string;
    readonly author?: { readonly displayName?: string; readonly emailAddress?: string };
    readonly modifiedTime?: string;
  }>;
}

export type Fetcher = (req: Request) => Promise<Response>;

export interface EncryptedCredentialStore {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}

export interface ConnectorLogger {
  readonly info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}
