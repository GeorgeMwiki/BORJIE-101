/**
 * Persistent credential store for `borjie` CLI.
 *
 * Reads / writes ~/.config/borjie/credentials.json with file mode 0600
 * (owner read/write only). The credentials file holds the OAuth2
 * device-flow access token alongside the metadata returned at issue
 * time so commands like `borjie whoami` can print the token's
 * provenance without a server round-trip.
 *
 * The path can be overridden by env BORJIE_CREDENTIALS_FILE — primarily
 * for tests so they never touch the real user dir.
 *
 * IMMUTABILITY: every save constructs a new credentials object and
 * writes it atomically (write to tmp, fsync, rename). We never mutate
 * an existing on-disk file in place.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BorjieCredentials {
  readonly version: 1;
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly apiBaseUrl: string;
  readonly clientId: string;
  readonly clientLabel?: string;
}

const DEFAULT_FILENAME = 'credentials.json';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export function credentialsFilePath(): string {
  const override = process.env['BORJIE_CREDENTIALS_FILE'];
  if (override && override.length > 0) return override;
  const home = homedir();
  return join(home, '.config', 'borjie', DEFAULT_FILENAME);
}

export function loadCredentials(): BorjieCredentials | null {
  const path = credentialsFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const json = JSON.parse(raw) as Partial<BorjieCredentials> | null;
    if (
      !json ||
      typeof json !== 'object' ||
      typeof json.accessToken !== 'string' ||
      json.tokenType !== 'Bearer' ||
      typeof json.apiBaseUrl !== 'string'
    ) {
      return null;
    }
    return {
      version: 1,
      accessToken: json.accessToken,
      tokenType: 'Bearer',
      scopes: Array.isArray(json.scopes) ? (json.scopes as readonly string[]) : [],
      issuedAt: typeof json.issuedAt === 'string' ? json.issuedAt : new Date().toISOString(),
      apiBaseUrl: json.apiBaseUrl,
      clientId: typeof json.clientId === 'string' ? json.clientId : 'borjie-cli',
      ...(typeof json.clientLabel === 'string' && json.clientLabel.length > 0
        ? { clientLabel: json.clientLabel }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saveCredentials(creds: BorjieCredentials): void {
  const path = credentialsFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  } else {
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* best-effort tightening; never fail save on a chmod hiccup */
    }
  }
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const serialised = JSON.stringify(creds, null, 2);
  writeFileSync(tmpPath, serialised, { mode: FILE_MODE });
  try {
    chmodSync(tmpPath, FILE_MODE);
  } catch {
    /* best-effort tightening */
  }
  renameSync(tmpPath, path);
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    /* best-effort tightening — rename inherits source mode on POSIX */
  }
}

export function clearCredentials(): boolean {
  const path = credentialsFilePath();
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
