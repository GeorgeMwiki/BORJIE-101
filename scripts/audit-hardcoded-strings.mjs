#!/usr/bin/env node
/**
 * Hardcoded-strings scanner — Piece P.
 *
 * Vision: every user-facing English UI string must live in the i18n
 * catalogue (`messages/en.json` / `messages/sw.json`) and be resolved
 * through `useTranslations()`. A capitalised English phrase baked into
 * JSX defeats the Swahili-ready promise of the product.
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `apps/* /src/**`
 *   - `packages/chat-ui/src/**`
 *   - `packages/genui/src/**`
 *   - `packages/dynamic-sections/src/**`
 *
 * and flags lines containing user-facing English strings that are NOT
 * wrapped in a translator call (`t(...)`).
 *
 * Detected patterns:
 *   - JSX text nodes:          `>Sentence here.<`
 *   - JSX attribute strings:   `placeholder="Enter your name"`,
 *                              `aria-label="Close"`, `title="..."`,
 *                              `alt="..."`, `label="..."`
 *   - Constant arrays of UI options: `label: 'Kitchen'`
 *
 * Excluded (NOT a violation):
 *   - Test / fixture / stories files (auto).
 *   - i18n catalogue directories.
 *   - Files in dev-facing surfaces (admin portals, error boundaries —
 *     see allowlist).
 *   - Strings that look like CSS classes, identifiers, URLs, emails,
 *     icons, single tokens, or already-translated `t('...')` calls.
 *   - Lines inside `console.*`, `Error(`, or `throw` (dev-only).
 *
 * Usage
 *   node scripts/audit-hardcoded-strings.mjs --report .audit/hardcoded-strings.json --summary .audit/hardcoded-strings.md
 *   node scripts/audit-hardcoded-strings.mjs --json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  walkDir,
  isProductionTsLike,
  isTestPath,
  parseArgs,
  buildReport,
  emitReport,
  computeStaleAllowlist,
  rel as relPath,
} from './lib/audit-helpers.mjs';
import { HARDCODED_STRINGS_ALLOWLIST } from './__allowlists__/hardcoded-strings-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// JSX text nodes: `>Capitalised text containing a space.<`. We require
// at least one space (excludes single-word identifiers) and a starting
// capital letter. The character class excludes braces (template
// interpolations), tags, and quote glyphs.
const JSX_TEXT_RX = />\s*([A-Z][A-Za-z0-9 ,\.\-'?!:;()&]{6,}?)\s*</;

// JSX attribute strings — limited to attributes whose presence implies
// user-facing copy (excludes id, className, key, ref, etc.).
const USER_FACING_ATTRS = [
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'title',
  'alt',
  'label',
];
const ATTR_STRING_RX = new RegExp(
  `\\b(${USER_FACING_ATTRS.join('|')})\\s*=\\s*(["'])([A-Z][A-Za-z0-9 ,\\.\\-'?!:;()&]{4,}?)\\2`,
);

// Constant-array UI option labels: `label: 'Foo Bar'` or
// `label: "Some text"`. We require >=4 chars + a capital letter.
const LABEL_PROP_RX = /\blabel\s*:\s*(["'`])([A-Z][A-Za-z0-9 ,\.\-'?!:;()&]{4,}?)\1/;

// Look at the WHOLE file for these signals — they indicate that the
// file already participates in i18n and we should be conservative
// about flagging it.
const USES_I18N_RX = /\b(useTranslations|getTranslations|createTranslator|next-intl|formatMessage)\b/;

// Lines we never flag — dev-only.
const DEV_LINE_RX =
  /^\s*(console\.|throw\s+new\s+Error|Error\(|\/\/|\*|\/\*|import\s+|export\s+\*\s+from|export\s+\{|export\s+type|export\s+interface)/;

// Phrases that look like dev-output (we never flag these).
const DEV_PHRASE_RX = /\b(stack trace|debug|TODO|FIXME|deprecated|internal|invariant|assertion)\b/i;

// File-name fragments that auto-skip the file as not part of user UI.
const SKIP_PATH_FRAGMENTS = [
  `${sep}messages${sep}`,
  `${sep}locales${sep}`,
  `${sep}i18n${sep}`,
  `${sep}translations${sep}`,
  `.stories.`,
  `.test.`,
  `.spec.`,
  // Type-only declaration files.
  `.d.ts`,
];

// In-scope directories.
const SCAN_DIRS = [
  'apps',
  'packages/chat-ui/src',
  'packages/genui/src',
  'packages/dynamic-sections/src',
];

// Path PREFIXES that auto-allowlist (whole-subtree): operator portals
// that are intentionally English-only. The product surface is
// `customer-app`, `owner-portal`, `estate-manager-app`, and the
// `borjie_app` mobile shell — those are the locale-targeted apps.
const ALLOW_PREFIX = [
  'apps/admin-platform-portal/',
  'apps/admin-portal/',
  'apps/marketing/',
];

function isPrefixAllowed(rel) {
  for (const p of ALLOW_PREFIX) if (rel.startsWith(p)) return true;
  return false;
}

function shouldSkipByPath(rel) {
  for (const frag of SKIP_PATH_FRAGMENTS) {
    if (rel.includes(frag)) return true;
  }
  // Only scan files actually under app/ src/ trees for the targeted
  // workspaces — skip generated, build artefacts, config files.
  if (!rel.includes(`${sep}src${sep}`)) return true;
  return false;
}

function discoverFiles(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    walkDir(join(root, top), isProductionTsLike, files);
  }
  return files;
}

function isLikelyEnglishPhrase(text) {
  // Reject single-token strings — they're usually identifiers, units,
  // or icon names.
  const trimmed = text.trim();
  if (!trimmed.includes(' ')) return false;
  // Reject things that look like CSS / URL / email / file path.
  if (/[\/\\]/.test(trimmed)) return false;
  if (/@/.test(trimmed)) return false;
  if (/^\d/.test(trimmed)) return false;
  // Must contain at least one lowercase letter (rules out pure UPPER
  // SNAKE labels and acronyms).
  if (!/[a-z]/.test(trimmed)) return false;
  // Must contain at least 2 English-looking words (alpha tokens >= 3).
  const tokens = trimmed.split(/\s+/).filter((t) => /^[A-Za-z][A-Za-z']*$/.test(t));
  return tokens.length >= 2;
}

function scanFile(src) {
  const hits = [];
  const lines = src.split('\n');
  // If the file participates in i18n, raise the bar: only flag the
  // most egregious patterns (attribute strings + label props), NOT
  // every JSX text node (which may contain `{t('...')}` interpolations
  // that the regex can't see).
  const i18nAware = USES_I18N_RX.test(src);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DEV_LINE_RX.test(line)) continue;
    if (DEV_PHRASE_RX.test(line)) continue;
    // Skip lines where i18n-aware files already wrap the literal.
    if (i18nAware && /\bt\s*\(\s*['"`][a-zA-Z]/.test(line)) continue;

    // Attribute-style flagging (every file gets this).
    const am = line.match(ATTR_STRING_RX);
    if (am && isLikelyEnglishPhrase(am[3])) {
      hits.push({
        line: i + 1,
        kind: 'attr',
        code: `${am[1]}=${am[2]}${am[3].slice(0, 40)}${am[2]}`,
        snippet: line.trim().slice(0, 140),
      });
      continue;
    }
    // Label-style prop flagging.
    const lm = line.match(LABEL_PROP_RX);
    if (lm && isLikelyEnglishPhrase(lm[2])) {
      hits.push({
        line: i + 1,
        kind: 'label',
        code: `label:'${lm[2].slice(0, 40)}'`,
        snippet: line.trim().slice(0, 140),
      });
      continue;
    }
    // JSX-text flagging (only for files NOT already i18n-aware — too
    // many false positives otherwise).
    if (!i18nAware) {
      const jm = line.match(JSX_TEXT_RX);
      if (jm && isLikelyEnglishPhrase(jm[1])) {
        hits.push({
          line: i + 1,
          kind: 'jsx-text',
          code: jm[1].slice(0, 60),
          snippet: line.trim().slice(0, 140),
        });
      }
    }
  }
  return hits;
}

function main() {
  const args = parseArgs(process.argv);
  const ROOT = args.root ? resolve(args.root) : DEFAULT_ROOT;
  const files = discoverFiles(ROOT);
  const violations = [];

  let totalScanned = 0;
  let totalTestSkipped = 0;
  let totalPathSkipped = 0;
  let totalAllowlisted = 0;
  let totalPrefixAllowed = 0;
  let totalClean = 0;

  for (const file of files) {
    const rel = relPath(ROOT, file);
    totalScanned++;
    if (isTestPath(rel)) {
      totalTestSkipped++;
      continue;
    }
    if (shouldSkipByPath(rel)) {
      totalPathSkipped++;
      continue;
    }
    if (isPrefixAllowed(rel)) {
      totalPrefixAllowed++;
      continue;
    }
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = scanFile(src);
    if (hits.length === 0) {
      totalClean++;
      continue;
    }
    if (HARDCODED_STRINGS_ALLOWLIST.has(rel)) {
      totalAllowlisted++;
      continue;
    }
    violations.push({
      file: rel,
      severity: 'MEDIUM',
      hits: hits.slice(0, 10),
      hitCount: hits.length,
    });
  }

  const staleAllowlist = args.root
    ? []
    : computeStaleAllowlist(ROOT, HARDCODED_STRINGS_ALLOWLIST);
  const report = buildReport(
    'hardcoded-strings',
    {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
      pathSkipped: totalPathSkipped,
      prefixAllowed: totalPrefixAllowed,
      clean: totalClean,
      allowlisted: totalAllowlisted,
      violations: violations.length,
    },
    violations,
    staleAllowlist,
  );
  const passed = emitReport(args, report);
  process.exit(passed || !args.strict ? 0 : 1);
}

main();
