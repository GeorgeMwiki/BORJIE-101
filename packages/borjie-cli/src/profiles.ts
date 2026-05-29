/**
 * Multi-profile credential store. Each profile is one file under
 * `~/.config/borjie/profiles/<name>.json` (mode 0600). The active
 * profile is named in `config.toml -> [defaults] profile = "..."`.
 *
 * For backwards compatibility, if no profile file exists but the
 * legacy `~/.config/borjie/credentials.json` does, we treat it as the
 * `default` profile and migrate on first save.
 *
 * Each profile carries its own apiUrl + accessToken, so a single
 * binary can fly between staging and prod with `borjie use staging`.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  ensureBorjieDir,
  profileFilePath,
  profilesDir,
} from './paths.js';
import {
  credentialsFilePath,
  loadCredentials,
  saveCredentials,
  type BorjieCredentials,
} from './credentials.js';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export interface BorjieProfile {
  readonly version: 1;
  readonly name: string;
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly clientId: string;
  readonly clientLabel?: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
}

export function listProfiles(): readonly BorjieProfile[] {
  const dir = profilesDir();
  if (!existsSync(dir)) return migrateLegacyToList();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const profiles: BorjieProfile[] = [];
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    const p = loadProfile(name);
    if (p) profiles.push(p);
  }
  return Object.freeze(profiles);
}

export function loadProfile(name: string): BorjieProfile | null {
  const path = profileFilePath(name);
  if (!existsSync(path)) {
    // Backwards compat — fall back to legacy credentials for `default`.
    if (name === 'default') {
      const legacy = loadCredentials();
      if (legacy) return credsToProfile('default', legacy);
    }
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const json = JSON.parse(raw) as Partial<BorjieProfile>;
    if (typeof json.accessToken !== 'string' || typeof json.apiUrl !== 'string') {
      return null;
    }
    return Object.freeze({
      version: 1,
      name,
      apiUrl: json.apiUrl,
      accessToken: json.accessToken,
      clientId: typeof json.clientId === 'string' ? json.clientId : 'borjie-cli',
      ...(typeof json.clientLabel === 'string' ? { clientLabel: json.clientLabel } : {}),
      scopes: Array.isArray(json.scopes) ? Object.freeze([...json.scopes]) : [],
      issuedAt: typeof json.issuedAt === 'string' ? json.issuedAt : new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

export function saveProfile(profile: BorjieProfile): void {
  const dir = profilesDir();
  const parentDir = dirname(profileFilePath(profile.name));
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true, mode: DIR_MODE });
  }
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }
  const path = profileFilePath(profile.name);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(profile, null, 2), { mode: FILE_MODE });
  try {
    chmodSync(tmpPath, FILE_MODE);
  } catch {
    /* best effort */
  }
  renameSync(tmpPath, path);
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    /* best effort */
  }
  // Mirror into legacy credentials.json so older tooling keeps working
  // (and so `whoami` shows the right thing when no config.toml exists).
  if (profile.name === 'default') {
    const credPath = credentialsFilePath();
    const credDir = dirname(credPath);
    if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true, mode: DIR_MODE });
    const legacy: BorjieCredentials = {
      version: 1,
      accessToken: profile.accessToken,
      tokenType: 'Bearer',
      scopes: profile.scopes,
      issuedAt: profile.issuedAt,
      apiBaseUrl: profile.apiUrl,
      clientId: profile.clientId,
      ...(profile.clientLabel ? { clientLabel: profile.clientLabel } : {}),
    };
    saveCredentials(legacy);
  }
}

export function deleteProfile(name: string): boolean {
  const path = profileFilePath(name);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function credsToProfile(name: string, c: BorjieCredentials): BorjieProfile {
  return Object.freeze({
    version: 1,
    name,
    apiUrl: c.apiBaseUrl,
    accessToken: c.accessToken,
    clientId: c.clientId,
    ...(c.clientLabel ? { clientLabel: c.clientLabel } : {}),
    scopes: c.scopes,
    issuedAt: c.issuedAt,
  });
}

function migrateLegacyToList(): readonly BorjieProfile[] {
  const legacy = loadCredentials();
  if (!legacy) return [];
  ensureBorjieDir('profiles');
  const profile = credsToProfile('default', legacy);
  saveProfile(profile);
  return Object.freeze([profile]);
}
