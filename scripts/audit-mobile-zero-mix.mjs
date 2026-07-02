#!/usr/bin/env node
/**
 * Audit: workforce-mobile / buyer-mobile screens for ZERO-MIX
 * violations — a single rendered string that carries BOTH Swahili and
 * English (dual-language-in-one-string).
 *
 * WHY THIS EXISTS
 * ---------------
 * The active-locale canon (CLAUDE.md: "toggle is ABSOLUTE — when `en`
 * selected zero Swahili appears anywhere and vice versa") forbids two
 * languages inside one rendered context. A hardcoded copy constant like
 *
 *     loading: 'Inapakia sampuli... · Loading samples...'
 *
 * ships BOTH languages in the SAME string on EVERY render, regardless of
 * the user's active locale — the exact mixing the canon forbids. The web
 * scanners (`audit-consent-sw-coverage`, `audit-hardcoded-locale-coverage`)
 * do not walk the Expo mobile app trees, so this is their mobile arm.
 *
 * ALGORITHM
 * ---------
 *   1. Walk the mobile app screen trees (workforce-mobile, buyer-mobile).
 *   2. For each .ts/.tsx line, find quoted string literals.
 *   3. A literal is a DUAL-LANGUAGE offender when it contains a middot
 *      separator (' · ') AND a recognizable Swahili UI stem AND a
 *      recognizable English word on the opposite side — i.e. one string
 *      renders both languages. The Swahili-stem + English-word pairing
 *      keeps legitimate single-language ' · ' data separators
 *      (`${name} · ${sku}`) out of the finding set.
 *   4. Also flag the ellipsis dual-load shape
 *      ('<sw>... · <en>...') that the loading constants use.
 *   5. Emit one row per finding; exit non-zero on any finding.
 *
 * Allowlist ratchet: `scripts/__allowlists__/mobile-zero-mix-allowlist.mjs`
 * A stale entry (path no longer matches) fails the run.
 *
 * Usage:
 *   node scripts/audit-mobile-zero-mix.mjs
 *   node scripts/audit-mobile-zero-mix.mjs --json
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOBILE_ZERO_MIX_ALLOWLIST } from './__allowlists__/mobile-zero-mix-allowlist.mjs';
import { MOBILE_BUNDLE_SHARED_ALLOWLIST } from './__allowlists__/mobile-bundle-shared-allowlist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `--root <dir>` overrides the scanned repo root (used by the unit test to
// point at a fixture tree); defaults to the repo root.
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx !== -1 ? resolve(process.argv[rootIdx + 1]) : resolve(__dirname, '..');

const SCAN_GLOBS = ['apps/workforce-mobile/app', 'apps/workforce-mobile/src'];

// Recognizable Swahili UI stems (loading verbs, common copy words). If a
// literal contains any of these AND an English word across a ' · ' or
// '...' seam, it renders both languages in one string.
const SW_STEMS = [
  'inapakia', 'inatuma', 'inasaini', 'inatengeneza', 'hakuna', 'bado', 'imeshindwa',
  'kupakia', 'mafunzo', 'kiswahili', 'sampuli', 'historia', 'bidhaa', 'mwendo',
  'mada', 'hati', 'barua', 'endelea', 'kazi', 'kwa sasa', 'karibu', 'hatua',
  'panga', 'hatari', 'migodi', 'jumla', 'tovuti', 'leseni'
];

// Recognizable English words that co-occur on the opposite side.
const EN_WORDS = [
  'loading', 'submitting', 'signing', 'creating', 'no ', 'failed', 'load',
  'items', 'movements', 'topics', 'documents', 'samples', 'pings', 'history',
  'training', 'catalogue', 'letter', 'briefing', 'list', 'now', 'yet'
];

const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function hasSwStem(s) {
  const low = s.toLowerCase();
  return SW_STEMS.some((w) => low.includes(w));
}
function hasEnWord(s) {
  const low = s.toLowerCase();
  return EN_WORDS.some((w) => low.includes(w));
}

// A literal is a dual-language offender when it carries a middot or an
// ellipsis seam AND recognizable Swahili AND recognizable English.
function isDualLanguage(literal) {
  const hasSeam = literal.includes(' · ') || literal.includes('…') || literal.includes('...');
  if (!hasSeam) return false;
  return hasSwStem(literal) && hasEnWord(literal);
}

// ---------------------------------------------------------------------------
// Bundle checks — the i18n JSON is the OTHER half of zero-mix. The literal
// scan above catches dual-language-in-one-string; these two catch the classes
// it is structurally blind to:
//   (A) PARITY — a leaf key present in one locale bundle but not the other. A
//       missing sw value renders the en string to a sw user (cross-language
//       fallback = mixing). Complete parity, no fallback, is canon.
//   (B) SW==EN LEAK — a sw value byte-identical to its en value that carries a
//       lowercase English word (the burnPrefix "Burn: " / catPricingLabel
//       "Pricing" class: an English string sitting untranslated in the sw
//       bundle). Legitimately-shared tokens (endonyms, proper nouns, adopted
//       loanwords, product terms) are ratcheted in the shared allowlist.
// ---------------------------------------------------------------------------
const BUNDLE_EN = 'apps/workforce-mobile/src/i18n/en.json';
const BUNDLE_SW = 'apps/workforce-mobile/src/i18n/sw.json';
const HAS_LOWER_WORD = /[a-z]{3,}/;

function flattenLeaves(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenLeaves(v, path, out);
    else out.set(path, v);
  }
}

function checkBundles() {
  const enAbs = resolve(ROOT, BUNDLE_EN);
  const swAbs = resolve(ROOT, BUNDLE_SW);
  // Fixture roots (unit test via --root) have no bundle — skip gracefully.
  if (!existsSync(enAbs) || !existsSync(swAbs)) {
    return { parityMissing: [], swEnLeaks: [] };
  }
  const en = new Map();
  const sw = new Map();
  flattenLeaves(JSON.parse(readFileSync(enAbs, 'utf8')), '', en);
  flattenLeaves(JSON.parse(readFileSync(swAbs, 'utf8')), '', sw);

  const parityMissing = [];
  for (const key of en.keys()) if (!sw.has(key)) parityMissing.push({ key, missingIn: 'sw' });
  for (const key of sw.keys()) if (!en.has(key)) parityMissing.push({ key, missingIn: 'en' });

  const swEnLeaks = [];
  for (const [key, swVal] of sw.entries()) {
    if (!en.has(key)) continue;
    const enVal = en.get(key);
    if (typeof swVal !== 'string' || typeof enVal !== 'string') continue;
    if (swVal !== enVal) continue;
    if (!HAS_LOWER_WORD.test(swVal)) continue; // codes / unit symbols / acronyms
    if (MOBILE_BUNDLE_SHARED_ALLOWLIST.has(swVal)) continue; // ratcheted legit-shared
    swEnLeaks.push({ key, value: swVal });
  }
  return { parityMissing, swEnLeaks };
}

function collectFiles(target) {
  const abs = resolve(ROOT, target);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return /\.(ts|tsx)$/.test(abs) ? [abs] : [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const child = join(abs, name);
    const cst = statSync(child);
    if (cst.isDirectory()) {
      out.push(...collectFiles(relative(ROOT, child)));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(child);
    }
  }
  return out;
}

function run() {
  const asJson = process.argv.includes('--json');

  const files = new Set();
  for (const g of SCAN_GLOBS) for (const f of collectFiles(g)) files.add(f);

  const findings = [];
  let scanned = 0;

  for (const abs of files) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (MOBILE_ZERO_MIX_ALLOWLIST.has(rel)) continue;
    scanned += 1;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      QUOTED.lastIndex = 0;
      let m;
      while ((m = QUOTED.exec(line)) !== null) {
        const literal = m[2];
        if (isDualLanguage(literal)) {
          findings.push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 120) });
        }
      }
    }
  }

  const staleAllowlist = [];
  for (const p of MOBILE_ZERO_MIX_ALLOWLIST) {
    if (!existsSync(resolve(ROOT, p))) staleAllowlist.push(p);
  }

  const { parityMissing, swEnLeaks } = checkBundles();

  const passed =
    findings.length === 0 &&
    staleAllowlist.length === 0 &&
    parityMissing.length === 0 &&
    swEnLeaks.length === 0;
  const report = {
    scannedAt: new Date().toISOString(),
    summary: {
      filesScanned: scanned,
      findings: findings.length,
      staleAllowlist: staleAllowlist.length,
      parityMissing: parityMissing.length,
      swEnLeaks: swEnLeaks.length,
    },
    findings,
    staleAllowlist,
    parityMissing,
    swEnLeaks,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-mobile-zero-mix: ${scanned} mobile files scanned, ${findings.length} dual-language + ${parityMissing.length} parity + ${swEnLeaks.length} sw==en-leak finding(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const f of findings.slice(0, 60)) {
      console.error(`  [DUAL-LANG] ${f.file}:${f.line}: ${f.snippet}`);
    }
    if (findings.length > 60) console.error(`  ... and ${findings.length - 60} more`);
    for (const p of parityMissing.slice(0, 60)) {
      console.error(`  [PARITY] key '${p.key}' missing in ${p.missingIn}.json`);
    }
    for (const l of swEnLeaks.slice(0, 60)) {
      console.error(`  [SW==EN LEAK] key '${l.key}' ships English '${l.value}' in sw.json`);
    }
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }

  process.exit(passed ? 0 : 1);
}

run();
