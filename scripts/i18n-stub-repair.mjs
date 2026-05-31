#!/usr/bin/env node
/**
 * i18n stub repair script.
 *
 * Scans every (en, sw) JSON pair under apps/, detects:
 *   - sw values identical to their en counterpart (English masquerading)
 *   - sw values containing TODO / FIXME / "translate"
 *   - keys present in en but missing in sw
 *
 * For each violation, invokes Claude (sonnet-4-5, temperature 0) with
 * the Borjie mining-domain system prompt and writes the real Swahili
 * translation back into the JSON file.
 *
 * Idempotent. Skips:
 *   - Brand strings ("Borjie", "Mr. Mwikila", "M-Pesa", "TRA", etc.)
 *   - Short identifiers (≤3 chars)
 *   - Pure-numeric values
 *   - Tokens that look like CSS variables / icon names
 *
 * Run with: ANTHROPIC_API_KEY=... node scripts/i18n-stub-repair.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load env (root .env then .env.local)
loadEnv({ path: path.resolve(process.cwd(), '.env'), override: true });
loadEnv({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const API_KEY =
  process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? '';
if (!API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const MODEL = 'claude-sonnet-4-5-20250929';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const BRAND_TOKENS = new Set([
  'Borjie', 'BossNyumba', 'Mr. Mwikila', 'M-Pesa', 'TRA', 'BRELA', 'NEMC',
  'LBMA', 'LMBM', 'SUMA', 'TZS', 'USD', 'KES', 'PML', 'ML', 'SML',
  'WhatsApp', 'iOS', 'Android', 'AI', 'API', 'SDK', 'PDF', 'CSV',
]);

const FILES = [
  ['apps/buyer-mobile/src/i18n/en.json', 'apps/buyer-mobile/src/i18n/sw.json'],
  ['apps/marketing/src/i18n/en.json', 'apps/marketing/src/i18n/sw.json'],
  ['apps/workforce-mobile/src/i18n/en.json', 'apps/workforce-mobile/src/i18n/sw.json'],
];

const STUB_RE = /TODO|FIXME|XXX|\btranslate\b/i;

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

function setDeep(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function shouldSkip(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 3) return true;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return true;
  if (/^[A-Z_]+$/.test(trimmed)) return true; // CONST_LIKE
  if (BRAND_TOKENS.has(trimmed)) return true;
  // Single short capitalized word — likely a brand or label
  if (/^[A-Z][a-z]{0,5}$/.test(trimmed)) return true;
  return false;
}

const SYSTEM = [
  'You are a professional EN→SW translator for Borjie, a Tanzanian AI-native mining estate operating system.',
  'Translate the user text from English into Tanzanian Swahili.',
  'Tanzanian Swahili variant: use Bantu vocabulary (asante, samahani, karibu). NOT Kenyan or Congolese variants.',
  'Preserve verbatim: Borjie, Mr. Mwikila, M-Pesa, TRA, BRELA, NEMC, LMBM, SUMA, PML, ML, SML, TZS, USD, KES.',
  'Preserve any {placeholder}, {{handlebars}}, %s, %d, $1, line breaks, markdown, HTML.',
  'Use neutral-professional register. Second-person wewe unless honorific is more natural.',
  'Reply with ONLY the translation. No preface, no quotes, no explanation.',
].join('\n');

const cache = new Map();

async function translateOne(text) {
  if (cache.has(text)) return cache.get(text);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`claude ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const block = (json.content ?? []).find((b) => b.type === 'text');
  if (!block) throw new Error('no text block');
  const translated = block.text.trim();
  cache.set(text, translated);
  return translated;
}

async function repairFile(enPath, swPath) {
  if (!fs.existsSync(enPath) || !fs.existsSync(swPath)) return;
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const sw = JSON.parse(fs.readFileSync(swPath, 'utf8'));
  const enFlat = flatten(en);
  const swFlat = flatten(sw);

  const violations = [];
  for (const k of Object.keys(enFlat)) {
    const enVal = enFlat[k];
    const swVal = swFlat[k];
    if (shouldSkip(enVal)) continue;
    if (swVal === undefined) {
      violations.push({ key: k, reason: 'missing', source: enVal });
    } else if (swVal === enVal) {
      violations.push({ key: k, reason: 'masq', source: enVal });
    } else if (typeof swVal === 'string' && STUB_RE.test(swVal)) {
      violations.push({ key: k, reason: 'stub', source: enVal });
    }
  }

  if (violations.length === 0) {
    console.log(`OK ${enPath}`);
    return;
  }

  console.log(`REPAIR ${swPath} — ${violations.length} violations`);
  const limit = Number(process.env.MAX_REPAIR ?? '120');
  const batch = violations.slice(0, limit);

  let done = 0;
  for (const v of batch) {
    try {
      const t = await translateOne(v.source);
      setDeep(sw, v.key, t);
      done++;
      if (done % 10 === 0) {
        console.log(`  ${done}/${batch.length}`);
        fs.writeFileSync(swPath, JSON.stringify(sw, null, 2) + '\n');
      }
    } catch (err) {
      console.error(`  FAIL ${v.key}: ${err.message}`);
    }
  }
  fs.writeFileSync(swPath, JSON.stringify(sw, null, 2) + '\n');
  console.log(`  wrote ${done}/${batch.length} to ${swPath}`);
}

console.log(`i18n-stub-repair starting — model=${MODEL}`);
for (const [enPath, swPath] of FILES) {
  await repairFile(enPath, swPath);
}
console.log('\nDONE');
