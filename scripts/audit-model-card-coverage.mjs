#!/usr/bin/env node
/**
 * Model-card coverage scanner (Wave-13 LITFIN-port primitive F3).
 *
 * Verifies that every Wave-12+ kernel/dynamic-sections MODEL has a
 * matching model card in BOTH jurisdictional regulator packs:
 *
 *   - `Docs/regulator-pack/tz/model-cards/<model>-v*.md`
 *   - `Docs/regulator-pack/ke/model-cards/<model>-v*.md`
 *
 * The check is structural — the scanner does not parse card contents,
 * only existence. The required model set is the canonical Wave-12+
 * ship list:
 *
 *   - adaptive-layout
 *   - three-agent-debate
 *   - online-judge
 *   - tier-policy-resolver
 *   - lats-search
 *   - reflexion-sleep
 *
 * A model is considered covered if a file matching
 * `<model>-v*.md` exists under each jurisdiction's `model-cards`
 * directory (any version suffix accepted — `-v1.md`, `-v2.md`, etc.).
 *
 * Usage:
 *   node scripts/audit-model-card-coverage.mjs --report .audit/model-card-coverage.json
 */

import {
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

export const REQUIRED_MODELS = [
  'adaptive-layout',
  'three-agent-debate',
  'online-judge',
  'tier-policy-resolver',
  'lats-search',
  'reflexion-sleep',
];

export const REQUIRED_JURISDICTIONS = ['tz', 'ke'];

function listModelCards(rootOverride, jurisdiction) {
  const root = rootOverride ?? ROOT;
  const dir = join(
    root,
    'Docs',
    'regulator-pack',
    jurisdiction,
    'model-cards',
  );
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.md'));
}

function hasCardFor(cards, model) {
  // Accept any -vN.md suffix variant — case-sensitive on the model id.
  const rx = new RegExp(`^${escapeRx(model)}-v\\d+(?:\\.\\d+)*\\.md$`);
  return cards.some((name) => rx.test(name));
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = { report: null, summary: null, json: false, root: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Model-card coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| required models | ${report.totals.requiredModels} |`);
  lines.push(`| jurisdictions | ${report.totals.jurisdictions} |`);
  lines.push(`| pairs missing | ${report.totals.missing} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Missing model cards');
    lines.push('');
    for (const v of report.violations) {
      lines.push(`- [${v.severity}] \`${v.model}\` missing in \`${v.jurisdiction}\``);
    }
  }
  return lines.join('\n');
}

export function runScan(opts = {}) {
  const root = opts.root ?? ROOT;
  const models = opts.models ?? REQUIRED_MODELS;
  const jurisdictions = opts.jurisdictions ?? REQUIRED_JURISDICTIONS;
  const violations = [];
  const byJurisdiction = {};
  for (const j of jurisdictions) byJurisdiction[j] = listModelCards(root, j);
  for (const model of models) {
    for (const j of jurisdictions) {
      const cards = byJurisdiction[j];
      if (!hasCardFor(cards, model)) {
        violations.push({ model, jurisdiction: j, severity: 'HIGH' });
      }
    }
  }
  return {
    scanner: 'model-card-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      requiredModels: models.length,
      jurisdictions: jurisdictions.length,
      missing: violations.length,
    },
    violations,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const report = runScan({ root: args.root });
  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }
  const passed = report.violations.length === 0;
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    process.stderr.write(
      `audit-model-card-coverage: ${report.totals.requiredModels} models × ${report.totals.jurisdictions} jurisdictions, ${report.totals.missing} missing — ${passed ? 'PASS' : 'FAIL'}\n`,
    );
    for (const v of report.violations) {
      process.stderr.write(`  [${v.severity}] ${v.model} :: ${v.jurisdiction}\n`);
    }
  }
  process.exit(passed ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
