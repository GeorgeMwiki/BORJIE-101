#!/usr/bin/env node
/**
 * gen-marketing-locales — author EN once, SOTA generates the rest.
 *
 * THE MODEL (translation-memory + SOTA fill):
 *   - `apps/marketing/src/i18n/en.json` is the SINGLE SOURCE you hand-edit.
 *   - `apps/marketing/src/i18n/sw.approved.json` is the curated/approved SW
 *     translation memory (flagship + reviewed strings). It is AUTHORITATIVE —
 *     SOTA never overwrites an approved value.
 *   - `apps/marketing/src/i18n/sw.json` is GENERATED: every EN key gets its
 *     approved SW if present, else a SOTA (`@borjie/translation`) translation
 *     (Claude Opus → glossary-locked → zero-mix-repaired). You do NOT hand-edit
 *     sw.json; you edit en.json (and optionally promote a SOTA value into
 *     sw.approved.json), then re-run this script.
 *
 * Why TM+fill, not regenerate-all: re-MT-ing already-reviewed marketing copy
 * risks degrading hand-crafted quality. Approved translations are the memory;
 * SOTA fills only the gaps (new / changed keys). This is how a real SOTA
 * localization pipeline works (TM + MT), and it scales to new locales:
 * add `<locale>.approved.json` + a target and re-run.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… node scripts/gen-marketing-locales.mjs            # generate sw.json
 *   node scripts/gen-marketing-locales.mjs --check                        # parity + gap report only (no API)
 *   node scripts/gen-marketing-locales.mjs --sample "<en text>"           # prove the SOTA path on one string
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// App-agnostic: `--app <name>` selects apps/<name>/src/i18n (default: marketing).
// This is "SOTA language, all places" — one generator for every app's catalogs.
const appArgIdx = process.argv.indexOf('--app');
const APP = appArgIdx !== -1 ? process.argv[appArgIdx + 1] : 'marketing';
const I18N = resolve(HERE, '..', 'apps', APP, 'src', 'i18n');
const EN_PATH = resolve(I18N, 'en.json');
const SW_OUT = resolve(I18N, 'sw.json');
const SW_APPROVED = resolve(I18N, 'sw.approved.json');

const TENANT = `borjie-${APP}`;
const SURFACE = APP;

// ── flatten / unflatten ────────────────────────────────────────────────────
function flatten(obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}
function setPath(root, path, value) {
  const parts = path.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

// ── SOTA translate() wiring (in-memory, Claude provider) ───────────────────
async function bindSota() {
  const [{ setGlobalTranslate, createTranslate, createInMemoryTranslationCache }, sota] =
    await Promise.all([
      import('@borjie/translation'),
      import('@borjie/translation-sota'),
    ]);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required to generate (use --check for an offline gap report)');
  const verbose = process.argv.includes('--verbose');
  const logger = {
    info: (m, meta) => { if (verbose) console.log('  [info]', m, JSON.stringify(meta ?? {})); },
    warn: (m, meta) => console.warn('  [warn]', m, JSON.stringify(meta ?? {})),
    error: (m, meta) => console.error('  [error]', m, JSON.stringify(meta ?? {})),
  };
  const claude = sota.createClaudeProvider({
    config: {
      apiKey,
      model: 'claude-opus-4-8',
      endpoint: 'https://api.anthropic.com/v1/messages',
      anthropicVersion: '2023-06-01',
      maxTokens: 1024,
    },
    // The provider calls fetcher({url,method,headers,body}) → {ok,status,text,json};
    // adapt the global fetch to that shape.
    fetcher: async ({ url, method, headers, body }) => {
      const r = await globalThis.fetch(url, { method, headers, body });
      return {
        ok: r.ok,
        status: r.status,
        text: () => r.text(),
        json: () => r.json(),
      };
    },
    now: () => Date.now(),
  });
  const runner = sota.createTranslationRunner({
    providers: [claude],
    overrideRepo: sota.createInMemoryGlossaryOverrideRepository(),
    runRepo: sota.createInMemoryTranslationRunRepository(),
    logger,
  });
  const translateFn = createTranslate({ cache: createInMemoryTranslationCache(), runner, logger });
  setGlobalTranslate(translateFn);
  const { translate } = await import('@borjie/translation');
  return async (text) => {
    const out = await translate(
      { text, sourceLang: 'en', targetLang: 'sw', surface: SURFACE, tenantId: TENANT },
      { safeFallback: text },
    );
    return out.text;
  };
}

// ── main ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--sample') ? 'sample' : 'generate';

const en = flatten(JSON.parse(readFileSync(EN_PATH, 'utf8')));
const approved = flatten(
  existsSync(SW_APPROVED)
    ? JSON.parse(readFileSync(SW_APPROVED, 'utf8'))
    : JSON.parse(readFileSync(SW_OUT, 'utf8')), // first run seeds TM from the current curated sw.json
);

const enKeys = Object.keys(en);
const gaps = enKeys.filter((k) => typeof en[k] === 'string' && !(k in approved));
console.log(`en leaf keys: ${enKeys.length} · approved SW: ${Object.keys(approved).length} · gaps to SOTA-fill: ${gaps.length}`);

if (mode === 'check') {
  console.log(gaps.length ? `GAPS:\n${gaps.slice(0, 40).join('\n')}` : 'No gaps — every EN key has an approved SW value.');
  process.exit(0);
}

if (mode === 'sample') {
  const text = args[args.indexOf('--sample') + 1] ?? 'Run your licences, royalty, crew and minerals from one screen';
  const t = await bindSota();
  console.log('EN:', text);
  console.log('SW:', await t(text));
  process.exit(0);
}

// generate: approved wins; SOTA fills gaps
const swFlat = { ...approved };
if (gaps.length) {
  const t = await bindSota();
  let i = 0;
  for (const k of gaps) {
    i += 1;
    process.stdout.write(`\r  SOTA-filling ${i}/${gaps.length} …`);
    try {
      swFlat[k] = await t(en[k]);
    } catch (e) {
      console.warn(`\n  [keep-en] ${k}: ${e.message?.slice(0, 60)}`);
      swFlat[k] = approved[k] ?? en[k];
    }
  }
  console.log('');
}

// rebuild nested, EN-key-ordered (guarantees parity by construction)
const out = {};
for (const k of enKeys) setPath(out, k, k in swFlat ? swFlat[k] : (typeof en[k] === 'string' ? en[k] : en[k]));
writeFileSync(SW_OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`Wrote ${SW_OUT} — ${enKeys.length} keys (${gaps.length} SOTA-filled, ${enKeys.length - gaps.length} from approved memory).`);
