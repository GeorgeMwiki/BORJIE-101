#!/usr/bin/env node
/**
 * run-pii-logs-scan — scans the monorepo for `console.*` / `logger.*`
 * calls whose payload mentions a known-PII field on the same line OR
 * within 3 lines beneath the call. Writes `audit-reports/pii-logs-
 * findings.json`.
 *
 * Always exits 0 — this is reporting, not a CI gate. Use the JSON
 * report to prioritize PII-redaction follow-up.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const EXCLUDED = new Set([
  'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage',
  '.audit', '.research', '.planning', '.git', '.claude', '.cursor',
  '.sidecar-venv', '.semgrep',
]);

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const PII_FIELDS = [
  'email', 'phone', 'phoneNumber', 'firstName', 'lastName', 'fullName',
  'address', 'street', 'postalCode', 'gpsLat', 'gpsLng', 'latitude',
  'longitude', 'taxId', 'kraPin', 'nidaNumber', 'iban', 'bankAccount',
  'bankAccountNumber', 'routingNumber', 'cardNumber', 'cvv',
  'mpesaNumber', 'mpesaPhone', 'idNumber', 'passportNumber',
  'driversLicense', 'ssn', 'dob', 'dateOfBirth',
];

const PII_RE = new RegExp(`\\b(${PII_FIELDS.join('|')})\\b\\s*[:=,)}]`, 'g');
const LOG_RE = /\b(console|logger|log|pino|childLogger|reqLogger)\s*\.\s*(log|info|debug|warn|error|fatal|trace)\s*\(/g;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (EXCLUDED.has(e)) continue;
    if (e.startsWith('.') && e !== '.github') continue;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (s.isFile() && EXTS.some((x) => e.endsWith(x))) out.push(p);
  }
}

function isInTestPath(rel) {
  return rel.includes('__tests__') || rel.includes('__fixtures__') ||
    rel.includes('/test-utils/') || rel.endsWith('.test.ts') ||
    rel.endsWith('.spec.ts') || rel.includes('/seeds/') ||
    rel.includes('/e2e/');
}

function isInScannerOwnPath(rel) {
  return rel.includes('security-audit') || rel.includes('pii-redactor') ||
    rel.includes('observability/src/logging');
}

function main() {
  const files = [];
  walk(ROOT, files);
  const findings = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (isInTestPath(rel) || isInScannerOwnPath(rel)) continue;
    let body;
    try { body = readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      LOG_RE.lastIndex = 0;
      if (!LOG_RE.test(line)) continue;
      const window = lines.slice(i, i + 4).join('\n');
      PII_RE.lastIndex = 0;
      const fields = new Set();
      let m;
      while ((m = PII_RE.exec(window)) !== null) {
        if (m[1]) fields.add(m[1]);
      }
      if (fields.size === 0) continue;
      findings.push({
        file: rel,
        line: i + 1,
        snippet: line.trim().slice(0, 240),
        piiFields: Array.from(fields).sort(),
        severity: fields.size > 1 ? 'high' : 'medium',
      });
    }
  }

  const reportPath = resolve(ROOT, 'audit-reports/pii-logs-findings.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({
      scannedAt: new Date().toISOString(),
      filesScanned: files.length,
      findingsCount: findings.length,
      findings,
    }, null, 2),
  );

  console.log(`pii-logs scan: ${files.length} files, ${findings.length} findings`);
  console.log(`report: audit-reports/pii-logs-findings.json`);
  process.exit(0);
}

main();
