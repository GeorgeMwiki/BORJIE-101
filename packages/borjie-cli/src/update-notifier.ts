/**
 * Update notifier — checks `npm view @borjie/cli version` no more than
 * once per 24 hours, caches the result in
 * `~/.config/borjie/update-check.json`, and prints a one-line banner
 * on the next CLI invocation if a newer version is available.
 *
 * Disabled when:
 *   - BORJIE_DISABLE_UPDATE_CHECK is set (any non-empty value)
 *   - The user config has [update_check] enabled = false
 *   - stdout is not a TTY (so JSON pipelines stay clean)
 *
 * Network failures are silently swallowed — we never fail the user's
 * command because the npm registry is slow.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureBorjieDir, updateCheckFilePath } from './paths.js';
import type { BorjieLogger } from './logger.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/@borjie%2Fcli';
const FETCH_TIMEOUT_MS = 1500;

interface UpdateCache {
  readonly checkedAt: string;
  readonly latestVersion: string | null;
}

export interface UpdateCheckResult {
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
}

export async function maybeNotifyUpdate(args: {
  readonly currentVersion: string;
  readonly logger: BorjieLogger;
  readonly enabled?: boolean;
}): Promise<UpdateCheckResult | null> {
  if (process.env['BORJIE_DISABLE_UPDATE_CHECK']) return null;
  if (args.enabled === false) return null;
  if (args.logger.opts.json) return null;
  if (!process.stdout.isTTY) return null;

  const cached = readCache();
  let latest = cached?.latestVersion ?? null;
  const now = Date.now();
  const cachedAt = cached ? Date.parse(cached.checkedAt) : 0;
  const stale = !cached || Number.isNaN(cachedAt) || now - cachedAt > ONE_DAY_MS;

  if (stale) {
    latest = await fetchLatestVersion();
    writeCache({ checkedAt: new Date().toISOString(), latestVersion: latest });
  }

  const updateAvailable = latest !== null && isNewer(latest, args.currentVersion);
  if (updateAvailable && latest) {
    args.logger.warn(
      `borjie ${latest} available (you have ${args.currentVersion}). Run: npm i -g @borjie/cli`,
    );
  }
  return { currentVersion: args.currentVersion, latestVersion: latest, updateAvailable };
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await globalThis.fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return json['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
}

function readCache(): UpdateCache | null {
  const path = updateCheckFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<UpdateCache>;
    if (typeof raw.checkedAt !== 'string') return null;
    return {
      checkedAt: raw.checkedAt,
      latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : null,
    };
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  ensureBorjieDir();
  try {
    writeFileSync(updateCheckFilePath(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch {
    /* swallow — best effort */
  }
}

/**
 * Compare two semver-ish versions. Returns true if `candidate > current`.
 * Handles `1.2.3`, `1.2.3-beta`, but not range syntax.
 */
export function isNewer(candidate: string, current: string): boolean {
  const c = parseVersion(candidate);
  const u = parseVersion(current);
  for (let i = 0; i < 3; i += 1) {
    const a = c[i] ?? 0;
    const b = u[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  // Same numeric — treat candidate without pre-release as newer than current with pre-release.
  const cPre = candidate.includes('-');
  const uPre = current.includes('-');
  if (!cPre && uPre) return true;
  return false;
}

function parseVersion(v: string): readonly number[] {
  const stripped = v.split('-')[0] ?? v;
  return stripped.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}
