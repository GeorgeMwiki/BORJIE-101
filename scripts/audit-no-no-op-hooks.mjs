#!/usr/bin/env node
/**
 * Audit-no-no-op-hooks — Phase F.3 CI gate.
 *
 * Greps production composition files for kernel orchestrator hook
 * factories called with EMPTY or NULL-PORT deps:
 *
 *   - `createPiiScrubHook({})`
 *   - `createPiiScrubHook({ scrubber: null })`
 *   - `createPermissionHook({})`
 *   - ... (every `create*Hook(...)` factory)
 *
 * Such a call would mean a production composition path is still wired
 * to the no-op defaults in `compose.ts:buildHookChain` — defeating the
 * point of `orchestrator-bindings.ts`. The factories themselves live
 * inside `packages/central-intelligence/src/kernel/orchestrator/` and
 * are exempt because their internal "default" branches are how
 * `compose.ts` keeps back-compat with callers that have not yet wired
 * the orchestrator block.
 *
 * Production composition paths audited:
 *   - `services/**\/composition/**`
 *   - `apps/**\/composition/**` (when those land)
 *
 * Exempt:
 *   - Anywhere under `packages/central-intelligence/` — the factories
 *     and their default-port stand-ins live there. The gate's purpose
 *     is to ensure production COMPOSITION ROOTS bind real ports, not
 *     to forbid the orchestrator itself from defining the defaults.
 *   - `__tests__/` directories — tests legitimately use the in-memory
 *     defaults to exercise the chain.
 *
 * Usage:
 *   node scripts/audit-no-no-op-hooks.mjs
 *   pnpm audit:no-op-hooks
 *
 * Exit codes:
 *   0  no violations
 *   1  one or more no-op factory calls found in production composition
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const HOOK_FACTORIES = [
  'createPiiScrubHook',
  'createPermissionHook',
  'createFourEyeHook',
  'createToolDenylistHook',
  'createRateLimitHook',
  'createCostCircuitHook',
  'createSandboxDivertHook',
  'createAuditEmissionHook',
  'createLedgerSealHook',
];

// Production composition roots to scan.
const SCAN_PATTERNS = [
  /^services\/[^/]+\/src\/composition\//,
  /^apps\/[^/]+\/src\/composition\//,
];

// Anything under these prefixes is exempt.
const EXEMPT_PREFIXES = [
  'packages/central-intelligence/',
  'node_modules/',
  'dist/',
  '.audit/',
];

// Filename / path fragments that mark a file as a test fixture.
const TEST_FILE_MARKERS = [
  '__tests__/',
  '.test.ts',
  '.spec.ts',
  '/tests/',
  '/test/',
];

// ---------------------------------------------------------------------------
// Pattern catalogue — what counts as a "no-op" factory call
// ---------------------------------------------------------------------------

/**
 * A factory call is a violation when its first argument is:
 *   - an empty object literal `{}`
 *   - an object whose single port-shaped key (`scrubber`, `scopes`,
 *     `policy`, `dynamic`, `counter`, `breaker`, `resolver`, `sink`,
 *     `ledger`) is bound to `null` / `undefined` / a literal `{}`.
 *
 * The detection is intentionally simple string-pattern matching to
 * keep the gate fast in CI. Sophisticated false-positives (a
 * legitimately empty deps block under a different brand) are not the
 * gate's concern — composition roots must be explicit.
 */
function buildViolationPatterns(factoryName) {
  const fnEscaped = factoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `createXxxHook({})` — exact empty object literal.
  const emptyDeps = new RegExp(`${fnEscaped}\\s*\\(\\s*\\{\\s*\\}\\s*\\)`);
  // `createXxxHook({ port: null })` / `createXxxHook({ port: undefined })`
  const nullPort = new RegExp(
    `${fnEscaped}\\s*\\(\\s*\\{[^}]*:\\s*(?:null|undefined)[^}]*\\}\\s*\\)`,
  );
  return [emptyDeps, nullPort];
}

const VIOLATION_PATTERNS = HOOK_FACTORIES.flatMap((fn) =>
  buildViolationPatterns(fn).map((re) => ({ factory: fn, regex: re })),
);

// ---------------------------------------------------------------------------
// File walk
// ---------------------------------------------------------------------------

function isExempt(rel) {
  for (const prefix of EXEMPT_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
  }
  for (const marker of TEST_FILE_MARKERS) {
    if (rel.includes(marker)) return true;
  }
  return false;
}

function inScanScope(rel) {
  for (const re of SCAN_PATTERNS) {
    if (re.test(rel)) return true;
  }
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(abs);
    } else if (
      st.isFile() &&
      (name.endsWith('.ts') || name.endsWith('.mts') || name.endsWith('.tsx'))
    ) {
      yield abs;
    }
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function auditFile(absPath) {
  const rel = relative(ROOT, absPath).split(sep).join('/');
  if (isExempt(rel)) return [];
  if (!inScanScope(rel)) return [];
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const violations = [];
  for (const { factory, regex } of VIOLATION_PATTERNS) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        violations.push({
          file: rel,
          line: i + 1,
          factory,
          excerpt: lines[i].trim(),
        });
      }
    }
  }
  return violations;
}

function runAudit() {
  const allViolations = [];
  for (const file of walk(ROOT)) {
    allViolations.push(...auditFile(file));
  }
  return allViolations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const violations = runAudit();

if (violations.length === 0) {
  console.log('audit-no-no-op-hooks: OK — no no-op hook bindings in production composition.');
  process.exit(0);
}

console.error('');
console.error(
  `audit-no-no-op-hooks: FAILED — ${violations.length} no-op hook binding(s) detected in production composition:`,
);
console.error('');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    factory: ${v.factory}`);
  console.error(`    excerpt: ${v.excerpt}`);
  console.error('');
}
console.error(
  'Production composition roots must bind real ports via `buildOrchestratorBindings(...)` ' +
    'in `services/api-gateway/src/composition/orchestrator-bindings.ts`. ' +
    'No-op factory calls defeat Phase F.3 policy enforcement.',
);
process.exit(1);
