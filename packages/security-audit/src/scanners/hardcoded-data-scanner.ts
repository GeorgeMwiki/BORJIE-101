/**
 * Hardcoded-data scanner.
 *
 * Walks a source tree looking for:
 *   - real tenant / org / user IDs that escaped seeds + fixtures
 *   - real-looking secrets (AWS, Stripe, Anthropic, OpenAI, Supabase
 *     service_role, JWT, generic API keys)
 *   - hardcoded external URLs outside the allow-list of vendor hosts
 *   - hardcoded phone numbers + emails (allow @example.com + 555-xxxx)
 *   - business-logic stubs (`throw new Error('not implemented')`,
 *     `return null as any`, `TODO: not implemented`).
 *
 * Test, fixture, mock, dist + node_modules paths are excluded so the
 * scanner is safe to run in CI without drowning the output in
 * known-fake values.
 *
 * Output: array of `Finding` records. Severity is one of:
 *   - critical: a real secret pattern matched in production code
 *   - high:     a tenant/org/user ID hardcoded outside seeds/tests,
 *               or an unstubbed business-logic stub
 *   - medium:   external URL, phone, or email leak
 *   - low:      everything else
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FindingKind =
  | 'tenant-id'
  | 'org-id'
  | 'user-id'
  | 'aws-access-key'
  | 'aws-secret-key'
  | 'stripe-secret-key'
  | 'anthropic-api-key'
  | 'openai-api-key'
  | 'supabase-service-role'
  | 'jwt-token'
  | 'generic-api-key'
  | 'github-token'
  | 'gcp-api-key'
  | 'external-url'
  | 'phone-number'
  | 'email-address'
  | 'not-implemented-stub'
  | 'null-as-any-stub'
  | 'price-magic-number';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly kind: FindingKind;
  readonly snippet: string;
  readonly severity: Severity;
  readonly matched: string;
}

export interface ScanOptions {
  /** Repository root the scanner walks. */
  readonly root: string;
  /** Path prefixes (relative to root) that are excluded from the scan. */
  readonly excludeDirs?: ReadonlyArray<string>;
  /** Path-prefix allow-list where tenant / org / user IDs are legitimate. */
  readonly idAllowedDirs?: ReadonlyArray<string>;
  /** File extensions the scanner reads. */
  readonly extensions?: ReadonlyArray<string>;
  /** Vendor hosts allowed to appear hardcoded (substring match). */
  readonly vendorHostAllowlist?: ReadonlyArray<string>;
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
  'docker',
  'monitoring',
  'k8s',
  'infrastructure',
  'evals',
];

const DEFAULT_ID_ALLOWED_DIRS: ReadonlyArray<string> = [
  'seeds',
  'seed',
  '__tests__',
  '__fixtures__',
  'tests',
  'test',
  'fixtures',
  'mocks',
  '.test.',
  '.spec.',
  'e2e',
  '/test-utils/',
];

const DEFAULT_VENDOR_HOST_ALLOWLIST: ReadonlyArray<string> = [
  'anthropic.com',
  'openai.com',
  'googleapis.com',
  'verra.org',
  'mapillary.com',
  'amazonaws.com',
  'sentry.io',
  'posthog.com',
  'supabase.co',
  'supabase.com',
  'github.com',
  'githubusercontent.com',
  'cloudflare.com',
  'stripe.com',
  'paystack.com',
  'twilio.com',
  'm-pesa.com',
  'safaricom.co.ke',
  'firs.gov.ng',
  'nimc.gov.ng',
  'opay-inc.com',
  'gepg.tz',
  'tra.go.tz',
  'nida.go.tz',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'example.com',
  'example.org',
  // Workspace-internal docker hostnames
  'api-gateway',
  'postgres',
  'redis',
  'minio',
];

const DEFAULT_EXTENSIONS: ReadonlyArray<string> = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

// ---------------------------------------------------------------------------
// Regex catalogue
// ---------------------------------------------------------------------------
// Patterns are deliberately permissive on the literal form but tight on
// the prefix/suffix to keep false positives bounded. Hardcoded-tenant
// patterns intentionally only match string literals to skip variable
// names like `tenantId`.

interface PatternSpec {
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly re: RegExp;
}

const PATTERNS: ReadonlyArray<PatternSpec> = [
  // Real-secret patterns (CRITICAL) - keep these first; once a line
  // matches a critical pattern we still continue (multiple kinds per line OK).
  {
    kind: 'aws-access-key',
    severity: 'critical',
    re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: 'aws-secret-key',
    // 40-char base64 — only flag when paired with `aws_secret` context
    // on the same line to keep noise down.
    severity: 'critical',
    re: /(?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"`]([A-Za-z0-9/+]{40})['"`]/gi,
  },
  {
    kind: 'stripe-secret-key',
    severity: 'critical',
    re: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  },
  {
    kind: 'anthropic-api-key',
    severity: 'critical',
    re: /\bsk-ant-api03-[A-Za-z0-9_-]{40,}\b/g,
  },
  {
    kind: 'openai-api-key',
    severity: 'critical',
    re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    kind: 'supabase-service-role',
    severity: 'critical',
    re: /\bservice_role['"`]?\s*[:=]\s*['"`]?eyJ[A-Za-z0-9_-]{20,}/g,
  },
  {
    kind: 'jwt-token',
    severity: 'critical',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    kind: 'github-token',
    severity: 'critical',
    re: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    kind: 'gcp-api-key',
    severity: 'critical',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: 'generic-api-key',
    // Treat any `apiKey: "<32+ chars>"` literal as critical when the
    // line does not look like an env-var binding.
    severity: 'critical',
    re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"`]([A-Za-z0-9_-]{32,})['"`]/gi,
  },

  // Tenant / org / user IDs (HIGH). Accept the public prefixes
  // (`tnt_`, `org_`, `usr_`) followed by any safe-id character set:
  // alphanumeric, underscore, dash. We previously over-restricted to
  // `[a-f0-9]` which missed real-shaped IDs like `tnt_acme_prod_…`.
  {
    kind: 'tenant-id',
    severity: 'high',
    re: /['"`](trc-tenant|demo-tenant|tnt_[A-Za-z0-9_-]{6,}|tenant_[A-Za-z0-9_-]{16,})['"`]/g,
  },
  {
    kind: 'org-id',
    severity: 'high',
    re: /['"`](org_[A-Za-z0-9_-]{8,}|organization_[A-Za-z0-9_-]{16,})['"`]/g,
  },
  {
    kind: 'user-id',
    severity: 'high',
    re: /['"`](usr_[A-Za-z0-9_-]{8,}|user_[A-Za-z0-9_-]{16,})['"`]/g,
  },

  // Not-implemented stubs (HIGH in production code)
  {
    kind: 'not-implemented-stub',
    severity: 'high',
    re: /(?:throw\s+new\s+Error\s*\(\s*['"`](?:not\s+implemented|TODO|FIXME)[^'"`]*['"`]\s*\))|(?:TODO:\s*not\s+implemented)/gi,
  },
  {
    kind: 'null-as-any-stub',
    severity: 'high',
    re: /\breturn\s+null\s+as\s+any\b/g,
  },

  // External URLs (MEDIUM) — vendor allow-list is applied below
  {
    kind: 'external-url',
    severity: 'medium',
    re: /['"`](https?:\/\/[A-Za-z0-9.\-:_]+[A-Za-z0-9/?#&=._-]*)['"`]/g,
  },

  // Phone numbers + emails (MEDIUM)
  {
    kind: 'phone-number',
    // E.164-ish patterns; allow 555-xxxx test numbers
    severity: 'medium',
    re: /['"`](\+?\d{1,3}[ -]?\(?\d{1,4}\)?[ -]?\d{3,5}[ -]?\d{3,5})['"`]/g,
  },
  {
    kind: 'email-address',
    severity: 'medium',
    re: /['"`]([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})['"`]/g,
  },

  // Magic price thresholds — only flag obvious `*Price = <large literal>`
  {
    kind: 'price-magic-number',
    severity: 'low',
    re: /(?:Price|Amount|Threshold|Cap|Limit)\s*[:=]\s*([0-9]{4,})\b/g,
  },
];

// Allowed test-domain emails / phones — short-circuit the medium finding.
function isAllowedTestEmail(value: string): boolean {
  return (
    value.endsWith('@example.com') ||
    value.endsWith('@example.org') ||
    value.endsWith('@test.local') ||
    value.endsWith('@borjie.local') ||
    value === 'noreply@borjie.com' ||
    value === 'security@borjie.com'
  );
}

function isAllowedTestPhone(value: string): boolean {
  // North-American test exchange (555-01xx) + local conventions
  return /\b555[ -]?01\d{2}\b/.test(value) || value.startsWith('+1555');
}

function looksLikeEnvBinding(line: string): boolean {
  // Skip lines that are env-var lookups, not literals.
  return (
    /process\.env\./.test(line) ||
    /Deno\.env/.test(line) ||
    /import\.meta\.env/.test(line) ||
    /from\s+['"]env['"]/.test(line)
  );
}

function isVendorHostAllowed(
  url: string,
  allowlist: ReadonlyArray<string>,
): boolean {
  return allowlist.some((host) => url.includes(host));
}

function isUnderAllowedDir(
  relPath: string,
  allowed: ReadonlyArray<string>,
): boolean {
  return allowed.some((token) => relPath.includes(token));
}

function isExcludedDir(name: string, excluded: ReadonlyArray<string>): boolean {
  return excluded.includes(name);
}

/**
 * Strip a `//`-style line comment from a single line of code without
 * eating `//` that appears inside string literals (e.g. URLs). Walks the
 * line character-by-character tracking which string delimiter we're in.
 * Returns the line with any trailing line-comment removed.
 */
function stripLineComment(line: string): string {
  let inString: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

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
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.github') {
      // Skip dot-directories except .github (which holds workflows we
      // sometimes want to scan). Most dot-dirs are excluded explicitly
      // in DEFAULT_EXCLUDED_DIRS but this guards against new ones too.
      if (entry !== '.gitleaks.toml' && entry !== '.trivyignore') continue;
    }
    if (isExcludedDir(entry, excluded)) continue;
    const fullPath = join(current, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(root, fullPath, excluded, exts, out);
    } else if (stat.isFile() && exts.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
  }
}

function scanFile(
  absPath: string,
  relPath: string,
  idAllowedDirs: ReadonlyArray<string>,
  vendorAllow: ReadonlyArray<string>,
): Finding[] {
  let body: string;
  try {
    body = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const lines = body.split(/\r?\n/);
  const findings: Finding[] = [];
  const inAllowedDir = isUnderAllowedDir(relPath, idAllowedDirs);

  // Track block-comment state across lines so JSDoc / multi-line
  // comments don't trip the medium-severity matchers.
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line) continue;
    let codePart = line;
    if (inBlockComment) {
      const closeIdx = codePart.indexOf('*/');
      if (closeIdx === -1) continue;
      codePart = codePart.slice(closeIdx + 2);
      inBlockComment = false;
    }
    while (true) {
      const openIdx = codePart.indexOf('/*');
      if (openIdx === -1) break;
      const closeIdx = codePart.indexOf('*/', openIdx + 2);
      if (closeIdx === -1) {
        codePart = codePart.slice(0, openIdx);
        inBlockComment = true;
        break;
      }
      codePart = codePart.slice(0, openIdx) + codePart.slice(closeIdx + 2);
    }
    if (!codePart.trim()) continue;
    // Skip lines that obviously document a finding rather than commit one
    if (/^\s*\/\/\s*(audit|allowlist|allow|allowed|test fixture)/i.test(line)) {
      continue;
    }
    codePart = stripLineComment(codePart);
    if (!codePart.trim()) continue;
    // SVG viewBox / d= path attrs frequently look like phone numbers.
    if (/viewBox\s*=|d\s*=\s*['"`]M/.test(codePart)) continue;

    for (const spec of PATTERNS) {
      // Reset the regex global state on each line.
      spec.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = spec.re.exec(codePart)) !== null) {
        const matched = match[1] ?? match[0];

        // Tenant / org / user IDs are allowed inside seeds + tests
        if (
          (spec.kind === 'tenant-id' ||
            spec.kind === 'org-id' ||
            spec.kind === 'user-id') &&
          inAllowedDir
        ) {
          continue;
        }

        // Secret-pattern hits in test paths are typically fixtures /
        // round-trip seeds for cryptographic plumbing. The
        // .gitleaks.toml ruleset already gates real-looking tokens;
        // the hardcoded-data scanner skips them in test paths to keep
        // the critical bucket signal-to-noise high.
        if (
          inAllowedDir &&
          (
            spec.kind === 'generic-api-key' ||
            spec.kind === 'anthropic-api-key' ||
            spec.kind === 'openai-api-key' ||
            spec.kind === 'stripe-secret-key' ||
            spec.kind === 'aws-access-key' ||
            spec.kind === 'aws-secret-key' ||
            spec.kind === 'jwt-token' ||
            spec.kind === 'github-token' ||
            spec.kind === 'gcp-api-key' ||
            spec.kind === 'supabase-service-role'
          )
        ) {
          continue;
        }

        // Generic-api-key detector — skip env-binding lines
        if (spec.kind === 'generic-api-key' && looksLikeEnvBinding(codePart)) {
          continue;
        }
        // Skip dev-only placeholders with explicit DO_NOT_USE markers
        if (
          spec.kind === 'generic-api-key' &&
          /(__DEV_STUB|DO_NOT_USE_IN_PROD|PLACEHOLDER|EXAMPLE|FAKE|MOCK)/i.test(matched)
        ) {
          continue;
        }

        // External-URL allow-list
        if (spec.kind === 'external-url') {
          if (isVendorHostAllowed(matched, vendorAllow)) continue;
          // Skip relative-looking URLs and well-known schemas
          if (
            matched.startsWith('http://localhost') ||
            matched.startsWith('http://127.0.0.1') ||
            matched.startsWith('http://0.0.0.0')
          ) {
            continue;
          }
        }

        // Email / phone allow-list
        if (spec.kind === 'email-address' && isAllowedTestEmail(matched)) {
          continue;
        }
        if (spec.kind === 'phone-number' && isAllowedTestPhone(matched)) {
          continue;
        }
        // Phone / email literals inside test paths are fixtures
        if (
          inAllowedDir &&
          (spec.kind === 'phone-number' || spec.kind === 'email-address')
        ) {
          continue;
        }
        // Phone literal inside form placeholder / pattern / label = input
        // example, not a PII leak.
        if (
          spec.kind === 'phone-number' &&
          /(placeholder|pattern|example|format|help|label)/i.test(codePart)
        ) {
          continue;
        }

        // Skip business-logic stubs inside scanners themselves to
        // avoid the audit tool flagging its own descriptions.
        if (
          (spec.kind === 'not-implemented-stub' ||
            spec.kind === 'null-as-any-stub') &&
          (relPath.includes('security-audit') || relPath.includes('scanners'))
        ) {
          continue;
        }

        findings.push({
          file: relPath,
          line: i + 1,
          kind: spec.kind,
          snippet: line.trim().slice(0, 240),
          severity: spec.severity,
          matched: matched.slice(0, 120),
        });
      }
    }
  }
  return findings;
}

/**
 * Run the scanner. Returns the full findings array; the caller can
 * group + serialize as it wishes.
 */
export function scanHardcodedData(opts: ScanOptions): Finding[] {
  const excluded = opts.excludeDirs ?? DEFAULT_EXCLUDED_DIRS;
  const idAllowed = opts.idAllowedDirs ?? DEFAULT_ID_ALLOWED_DIRS;
  const exts = opts.extensions ?? DEFAULT_EXTENSIONS;
  const vendorAllow = opts.vendorHostAllowlist ?? DEFAULT_VENDOR_HOST_ALLOWLIST;

  const files: string[] = [];
  walk(opts.root, opts.root, excluded, exts, files);

  const findings: Finding[] = [];
  for (const abs of files) {
    const rel = relative(opts.root, abs).split(sep).join('/');
    findings.push(...scanFile(abs, rel, idAllowed, vendorAllow));
  }
  return findings;
}

/**
 * Aggregate findings by severity. Useful for the JSON report header.
 */
export function summarize(findings: ReadonlyArray<Finding>): {
  readonly total: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly byKind: Readonly<Record<FindingKind, number>>;
} {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const kinds: Partial<Record<FindingKind, number>> = {};
  for (const f of findings) {
    counts[f.severity] += 1;
    kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  }
  return {
    total: findings.length,
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    byKind: kinds as Readonly<Record<FindingKind, number>>,
  };
}
