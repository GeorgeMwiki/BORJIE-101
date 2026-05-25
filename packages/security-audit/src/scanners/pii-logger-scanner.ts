/**
 * PII-in-logs scanner.
 *
 * Finds `console.*` / `logger.*` / `log.*` / `pino.*` calls whose
 * argument object literally references a PII field name on the same
 * line (`email`, `phone`, `firstName`, `lastName`, `address`, `gpsLat`,
 * `gpsLng`, `taxId`, `iban`, `bankAccount`, `mpesaNumber`).
 *
 * The scanner is line-based — it deliberately accepts false positives
 * on multi-line object literals so we err on the side of audit-them,
 * not skip-them. The remediation is to either:
 *   - replace the call with the `redactPII()` wrapper (see
 *     packages/observability/src/pii-redactor.ts), or
 *   - drop the PII field from the log payload entirely.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface PiiLoggerFinding {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly piiFields: ReadonlyArray<string>;
  readonly severity: 'high' | 'medium';
}

export interface PiiScanOptions {
  readonly root: string;
  readonly excludeDirs?: ReadonlyArray<string>;
  readonly extensions?: ReadonlyArray<string>;
}

const DEFAULT_EXCLUDED_DIRS: ReadonlyArray<string> = [
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.audit',
  '.research',
  '.planning',
  '.git',
  '.claude',
  '.cursor',
  '.sidecar-venv',
  '.semgrep',
];

const DEFAULT_EXTENSIONS: ReadonlyArray<string> = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

export const PII_FIELD_NAMES: ReadonlyArray<string> = [
  'email',
  'phone',
  'phoneNumber',
  'firstName',
  'lastName',
  'fullName',
  'address',
  'street',
  'postalCode',
  'gpsLat',
  'gpsLng',
  'latitude',
  'longitude',
  'taxId',
  'kraPin',
  'nidaNumber',
  'iban',
  'bankAccount',
  'bankAccountNumber',
  'routingNumber',
  'cardNumber',
  'cvv',
  'mpesaNumber',
  'mpesaPhone',
  'idNumber',
  'passportNumber',
  'driversLicense',
  'ssn',
  'dob',
  'dateOfBirth',
];

const PII_FIELD_RE = new RegExp(
  `\\b(${PII_FIELD_NAMES.join('|')})\\b\\s*[:=,)}]`,
  'g',
);

// Catch `console.log(`, `logger.info(`, `log.debug(`, `pino.warn(`, etc.
const LOGGER_CALL_RE =
  /\b(console|logger|log|pino|childLogger|reqLogger)\s*\.\s*(log|info|debug|warn|error|fatal|trace)\s*\(/g;

function walk(
  root: string,
  current: string,
  excluded: ReadonlyArray<string>,
  exts: ReadonlyArray<string>,
  out: string[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }
  for (const e of entries) {
    if (excluded.includes(e)) continue;
    const p = join(current, e);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(root, p, excluded, exts, out);
    } else if (s.isFile() && exts.some((ext) => e.endsWith(ext))) {
      out.push(p);
    }
  }
}

function isInTestPath(rel: string): boolean {
  return (
    rel.includes('__tests__') ||
    rel.includes('__fixtures__') ||
    rel.includes('/test-utils/') ||
    rel.endsWith('.test.ts') ||
    rel.endsWith('.spec.ts') ||
    rel.includes('/seeds/') ||
    rel.includes('/e2e/')
  );
}

function isInScannerOwnPath(rel: string): boolean {
  return (
    rel.includes('security-audit') ||
    rel.includes('pii-redactor') ||
    rel.includes('observability/src/logging')
  );
}

export function scanPiiInLogs(opts: PiiScanOptions): PiiLoggerFinding[] {
  const excluded = opts.excludeDirs ?? DEFAULT_EXCLUDED_DIRS;
  const exts = opts.extensions ?? DEFAULT_EXTENSIONS;
  const files: string[] = [];
  walk(opts.root, opts.root, excluded, exts, files);

  const findings: PiiLoggerFinding[] = [];
  for (const abs of files) {
    const rel = relative(opts.root, abs).split(sep).join('/');
    if (isInTestPath(rel) || isInScannerOwnPath(rel)) continue;

    let body: string;
    try {
      body = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      LOGGER_CALL_RE.lastIndex = 0;
      if (!LOGGER_CALL_RE.test(line)) continue;
      // Look at this line + up to 3 following lines for PII fields —
      // logger calls frequently span multi-line object literals.
      const window = lines.slice(i, i + 4).join('\n');
      PII_FIELD_RE.lastIndex = 0;
      const fields = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = PII_FIELD_RE.exec(window)) !== null) {
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
  return findings;
}
