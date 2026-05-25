/**
 * env-mutators.mjs — pure parsers + serialisers for `.env`-style files.
 *
 * Design:
 *   - parseEnvFile(text) → { KEY: value }   (lossless of values)
 *   - serialiseEnvFile(original, next) → preserves original comments and
 *     ordering. Lines that exist in `original` are updated in-place; new
 *     keys are appended in a `# === Added by setup-env ===` block.
 *   - mergeEnv(a, b, opts) — immutable merge. `opts.onlyIfPlaceholder` skips
 *     keys already populated with a real value.
 *
 * Zero deps. ESM. Tested by scripts/setup-borjie-env.test.mjs.
 */

import { isTodoMarker } from './env-secrets.mjs';

const KV_RE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const PLACEHOLDER_FRAGMENTS = ['your-', 'replace-me', 'TODO_BORJIE_', 'TODO_'];

/**
 * parseEnvFile — flat key/value map. Comment + blank lines ignored.
 *
 * Values are returned VERBATIM (no unescaping) because we round-trip them
 * back out via serialiseEnvFile and don't want to mangle quoting.
 */
export function parseEnvFile(text) {
  if (typeof text !== 'string') return {};
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+/, ''); // trim leading whitespace only
    if (!line || line.startsWith('#')) continue;
    const m = line.match(KV_RE);
    if (!m) continue;
    const [, key, value] = m;
    out[key] = value;
  }
  return out;
}

/**
 * isPlaceholder — true if a value looks like a stand-in we should overwrite.
 * Defensive: empty string + obvious placeholder fragments + TODO markers.
 */
export function isPlaceholder(value) {
  if (typeof value !== 'string') return true;
  if (value === '') return true;
  for (const frag of PLACEHOLDER_FRAGMENTS) if (value.includes(frag)) return true;
  if (isTodoMarker(value)) return true;
  return false;
}

/**
 * mergeEnv — immutable: returns a fresh object. NEVER mutates inputs.
 *
 * @param {Record<string,string>} base
 * @param {Record<string,string>} patch
 * @param {{ onlyIfPlaceholder?: boolean }} [opts]
 */
export function mergeEnv(base, patch, opts = {}) {
  const { onlyIfPlaceholder = false } = opts;
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (onlyIfPlaceholder && k in next && !isPlaceholder(next[k])) {
      continue; // preserve user-set value
    }
    next[k] = v;
  }
  return next;
}

/**
 * patchSupabaseKeys — narrow helper for the four Supabase-specific fields.
 * Always overrides them (Supabase keys come from authoritative API).
 */
export function patchSupabaseKeys(base, supabasePatch) {
  return {
    ...base,
    ...(supabasePatch.NEXT_PUBLIC_SUPABASE_URL && { NEXT_PUBLIC_SUPABASE_URL: supabasePatch.NEXT_PUBLIC_SUPABASE_URL }),
    ...(supabasePatch.NEXT_PUBLIC_SUPABASE_ANON_KEY && { NEXT_PUBLIC_SUPABASE_ANON_KEY: supabasePatch.NEXT_PUBLIC_SUPABASE_ANON_KEY }),
    ...(supabasePatch.SUPABASE_SERVICE_ROLE_KEY && { SUPABASE_SERVICE_ROLE_KEY: supabasePatch.SUPABASE_SERVICE_ROLE_KEY }),
    ...(supabasePatch.SUPABASE_JWT_SECRET && { SUPABASE_JWT_SECRET: supabasePatch.SUPABASE_JWT_SECRET }),
  };
}

/**
 * serialiseEnvFile — round-trip a flat env map back to a dotenv-format
 * string. Preserves original ordering and comments by walking the
 * `originalText` line-by-line. Keys that exist in `next` but not in
 * `originalText` are appended at the end under a marker comment.
 */
export function serialiseEnvFile(originalText, next) {
  const seen = new Set();
  const lines = (originalText || '').split(/\r?\n/);
  const updatedLines = lines.map((line) => {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) return line;
    const key = m[1];
    if (!(key in next)) return line;
    seen.add(key);
    return `${key}=${next[key]}`;
  });

  // Append any brand-new keys (i.e. keys not in originalText).
  const fresh = Object.keys(next).filter((k) => !seen.has(k));
  if (fresh.length > 0) {
    if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== '') {
      updatedLines.push('');
    }
    updatedLines.push('# === Added by scripts/setup-borjie-env.mjs ===');
    for (const k of fresh) updatedLines.push(`${k}=${next[k]}`);
  }
  return updatedLines.join('\n');
}
