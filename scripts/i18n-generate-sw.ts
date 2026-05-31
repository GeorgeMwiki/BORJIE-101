/**
 * i18n Swahili-dictionary generator.
 *
 * Reads the English source-of-truth dictionary
 * (`apps/owner-web/src/i18n/dictionaries/en.ts`), translates every
 * string en→sw with Claude (tier-1, the same model the gateway's
 * `@borjie/translation` facade binds at boot), and writes the
 * machine-generated `sw.ts` mirror.
 *
 * WHY A DEDICATED MICROCOPY CALL (not the sentence-tuned SOTA runner):
 * UI labels are mostly 1–4 words. The general translation runner can
 * misread a bare word ("Continue") as a chat prompt and answer it. This
 * generator instead does ONE batched JSON request with a strict
 * microcopy system prompt — every key sees the same UI context, so
 * single-word labels resolve to the standard Swahili term, placeholders
 * and trailing punctuation survive, and there is no markdown/preamble
 * leakage. We still validate every output with `@borjie/translation`'s
 * `checkContamination` so an English leak can never reach `sw.ts`.
 *
 * CONTENT-ADDRESSED: a sidecar cache (`.sw-cache.json`) stores, per key,
 * a hash of the English source plus its Swahili translation. Only keys
 * whose English source changed (or are new) hit the model — so a re-run
 * after a no-op edit costs ~0 and is fully offline.
 *
 * Usage:  pnpm i18n:gen            (translate changed keys, write sw.ts)
 *         pnpm i18n:gen --check    (fail if sw.ts is stale — for CI)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkContamination } from '@borjie/translation';

import { en } from '../apps/owner-web/src/i18n/dictionaries/en';

// ─── Paths ──────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DICT_DIR = resolve(REPO_ROOT, 'apps/owner-web/src/i18n/dictionaries');
const SW_FILE = resolve(DICT_DIR, 'sw.ts');
const CACHE_FILE = resolve(DICT_DIR, '.sw-cache.json');

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

const isCheck = process.argv.includes('--check');

// ─── Flatten / unflatten ────────────────────────────────────────────

type Flat = Record<string, string>;

function flatten(obj: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    }
  }
  return out;
}

function unflatten(flat: Flat): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return root;
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── Env ────────────────────────────────────────────────────────────

function loadAnthropicKey(): string {
  const fromEnv = process.env['ANTHROPIC_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const envPath = resolve(REPO_ROOT, '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/);
      if (match) return match[1]!.replace(/^["']|["']$/g, '').trim();
    }
  }
  throw new Error(
    'ANTHROPIC_API_KEY not set (env or .env.local) — cannot generate sw.ts',
  );
}

// ─── Claude microcopy translation (one batched JSON call) ───────────

const SYSTEM_PROMPT = `You translate product UI microcopy from English into Tanzanian Kiswahili for a mining-estate operating system called Borjie.

Rules — follow ALL exactly:
- Translate the VALUE of each key. Return Kiswahili ONLY in every value. Never echo English words except the brand name "Borjie" and untranslatable proper nouns (e.g. "Tanzania", "Email" stays "Barua pepe", "API" may stay "API").
- These are short UI labels and buttons, NOT questions to answer. "Continue" → "Endelea", "Next" → "Ifuatayo", "Back" → "Rudi", etc. Use the standard, concise Kiswahili UI term.
- Preserve every {placeholder} token verbatim (same name, same braces).
- Preserve trailing punctuation and ellipsis (…) exactly as in the source.
- Preserve the separator character "·" verbatim.
- No markdown, no quotes around values, no commentary, no leading "#".
- Output MUST be a single JSON object: the SAME keys as the input, each value the Kiswahili translation. Nothing before or after the JSON.`;

interface AnthropicResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

async function translateBatch(stale: Flat, apiKey: string): Promise<Flat> {
  const userPayload = JSON.stringify(stale, null, 2);
  const response = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Translate the values of this JSON object to Tanzanian Kiswahili. Return only the JSON object.\n\n${userPayload}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await response.json()) as AnthropicResponse;
  const text = json.content?.find((c) => c.type === 'text')?.text ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`Claude returned no JSON object: ${text.slice(0, 200)}`);
  }
  let parsed: Flat;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Flat;
  } catch (err) {
    throw new Error(`Could not parse Claude JSON: ${(err as Error).message}`);
  }
  return parsed;
}

// ─── Cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  readonly h: string;
  readonly sw: string;
}
type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

// ─── Emit sw.ts ─────────────────────────────────────────────────────

function emitSwFile(swFlat: Flat): string {
  const tree = unflatten(swFlat);
  const body = JSON.stringify(tree, null, 2);
  return `/**
 * GENERATED — do not edit by hand.
 *
 * Swahili mirror of \`en.ts\`, produced by \`scripts/i18n-generate-sw.ts\`
 * (Claude tier-1, contamination-checked). Run \`pnpm i18n:gen\` after
 * editing en.ts to regenerate.
 */

export const sw = ${body} as const;
`;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const enFlat = flatten(en as unknown as Record<string, unknown>);
  const cache = loadCache();

  const stale: Flat = {};
  for (const [key, enValue] of Object.entries(enFlat)) {
    const entry = cache[key];
    if (!entry || entry.h !== hashOf(enValue)) stale[key] = enValue;
  }
  const staleKeys = Object.keys(stale);

  if (isCheck) {
    if (staleKeys.length > 0) {
      process.stderr.write(
        `i18n:check FAILED — sw.ts is stale for ${staleKeys.length} key(s):\n` +
          staleKeys.map((k) => `  - ${k}`).join('\n') +
          `\nRun: pnpm i18n:gen\n`,
      );
      process.exit(1);
    }
    process.stdout.write('i18n:check OK — sw.ts is in sync with en.ts\n');
    return;
  }

  const nextCache: Cache = {};
  const swFlat: Flat = {};

  for (const [key, enValue] of Object.entries(enFlat)) {
    const entry = cache[key];
    if (entry && entry.h === hashOf(enValue)) {
      swFlat[key] = entry.sw;
      nextCache[key] = entry;
    }
  }

  if (staleKeys.length > 0) {
    process.stdout.write(
      `Translating ${staleKeys.length} new/changed key(s) en→sw via Claude…\n`,
    );
    const translated = await translateBatch(stale, loadAnthropicKey());

    for (const [key, enValue] of Object.entries(stale)) {
      const swValue = translated[key];
      if (typeof swValue !== 'string' || swValue.trim().length === 0) {
        throw new Error(`Missing/empty translation for key "${key}" — aborting.`);
      }
      // Placeholders must survive.
      const enVars = (enValue.match(/\{(\w+)\}/g) ?? []).sort();
      const swVars = (swValue.match(/\{(\w+)\}/g) ?? []).sort();
      if (JSON.stringify(enVars) !== JSON.stringify(swVars)) {
        throw new Error(
          `Placeholder mismatch for "${key}": en=${enVars.join(',')} sw=${swVars.join(',')}`,
        );
      }
      // Purity gate: the Swahili output must not leak English back.
      const contamination = checkContamination(swValue, 'sw', {
        maxLeakRatio: 0.34,
      });
      if (!contamination.ok) {
        throw new Error(
          `Contamination in "${key}": "${swValue}" leaked [${contamination.leakedTokens.join(', ')}] (${(contamination.leakRatio * 100).toFixed(0)}%)`,
        );
      }
      swFlat[key] = swValue;
      nextCache[key] = { h: hashOf(enValue), sw: swValue };
    }
  } else {
    process.stdout.write('All keys already cached — sw.ts is up to date.\n');
  }

  writeFileSync(SW_FILE, emitSwFile(swFlat), 'utf8');
  writeFileSync(CACHE_FILE, `${JSON.stringify(nextCache, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${Object.keys(swFlat).length} keys → ${SW_FILE}\n`);
}

main().catch((err) => {
  process.stderr.write(`i18n:gen failed: ${(err as Error).message}\n`);
  process.exit(1);
});
