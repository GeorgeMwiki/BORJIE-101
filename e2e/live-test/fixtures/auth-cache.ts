/**
 * Read the bootstrap tokens cached by globalSetup. Specs call this in
 * `test.beforeAll()` to get the owner + cross-tenant-other JWTs without
 * re-authenticating against Supabase on every spec.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '..', '.live-test-token.json');

interface CachedTokens {
  ownerToken: string;
  otherToken: string;
}

export function readCachedTokens(): CachedTokens {
  if (!existsSync(TOKEN_FILE)) {
    throw new Error(
      `live-test cache missing at ${TOKEN_FILE}. globalSetup must run first.`,
    );
  }
  const parsed = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as CachedTokens;
  if (!parsed.ownerToken || !parsed.otherToken) {
    throw new Error(`live-test cache malformed at ${TOKEN_FILE}`);
  }
  return parsed;
}
