#!/usr/bin/env node
/**
 * Wrapper around `pnpm audit --json` that allows a documented allowlist
 * of accepted-risk advisories. Exits 0 only when EVERY high+ advisory
 * is in the allowlist; otherwise exits 1 with a structured failure
 * report so operators can see exactly which advisory needs action.
 *
 * Usage: node scripts/audit-with-allowlist.mjs
 *
 * The allowlist below covers two categories:
 *   1. Unfixable: the upstream patched version does not exist on npm
 *      (e.g. lodash >=4.18.0 — latest published is 4.17.21).
 *   2. Major-version breaking change deferred to its own PR
 *      (e.g. drizzle-orm 0.36 → 0.45).
 *
 * Each entry includes `reason`, `tracked_in`, and `next_review` so the
 * accept-decision is auditable. The CI fails fast if a NEW advisory
 * appears outside the allowlist.
 */

import { execSync } from 'node:child_process';

const ALLOWLIST = [
  {
    package: 'lodash',
    severity: ['high', 'moderate'],
    fix: '>=4.18.0',
    reason:
      'lodash patched version >=4.18.0 does not exist on npm (latest is 4.17.21). The vulnerabilities are in `_.template` (code injection) and `_.unset` array-path (prototype pollution). Codebase audit confirmed no `_.template` calls accept untrusted input. Migration to lodash-es or per-function imports is tracked separately.',
    tracked_in: 'Docs/DEP_HYGIENE.md (lodash migration)',
    next_review: '2026-Q3',
  },
  {
    package: 'drizzle-orm',
    severity: ['high'],
    fix: '>=0.45.2',
    reason:
      'drizzle-orm 0.36 → 0.45 is a major version upgrade with breaking schema-builder changes (override pinned at 0.36.4 for the wave-1 schemas). The SQL-injection-via-improperly-escaped-identifiers fix only applies when callers pass tenant-controlled identifier strings into raw SQL — codebase audit confirmed all our calls use Drizzle\'s typed builders, not raw identifier interpolation.',
    tracked_in: 'Docs/DEP_HYGIENE.md (drizzle-orm 0.45 migration)',
    next_review: '2026-Q2',
  },
  // wave-L upgrade (W1, 2026-05-17): OpenTelemetry sdk-node 0.218.0 +
  // auto-instrumentations-node 0.76.0 land in this PR — both ship the
  // GHSA-q7rr-3cgh-j5r3 Prometheus-exporter fix, so the two previous
  // allowlist entries for those packages are gone. If a regression
  // reintroduces a vulnerable version the audit script will flip
  // blocking again rather than silently re-accept the risk.
  //
  // wave-L audit (W4, 2026-05-17): re-verified all three vega mitigations.
  //   1. `grep -r VEGA_DEBUG` across .ts/.tsx/.js/.mjs/.env*/.json returns
  //      ZERO hits outside this file — VEGA_DEBUG is never set anywhere
  //      in app code, environment files, or runtime config.
  //   2. ajv compiles a Vega-Lite structural schema and validates EVERY
  //      spec before render in both the server-side render-block
  //      (packages/central-intelligence/src/kernel/tools/render-blocks/
  //      validate.ts:27-31) and the client-side consumer
  //      (apps/admin-platform-portal/src/lib/genui/validate.ts:82-89 +
  //      VegaChart.tsx:55-63, which refuses to render unless ajvOk.ok).
  //   3. No `setdata` invocations exist in genui/ or render-blocks/ —
  //      VegaChart uses the declarative `data: { values: props.data }`
  //      injection pattern; setdata is never called client-side with
  //      user-controlled data. The Vega runtime's internal setdata runs
  //      only against server-emitted, ajv-validated payloads.
  // Mitigations hold; vega 6.x major migration remains deferred (closed
  // dependabot #60). Next review pushed to 2026-Q4.
  {
    package: 'vega',
    severity: ['high'],
    fix: '>=6.2.0',
    reason:
      'GHSA-7f2v-3qq3-vvjf: Vega XSS via expressions abusing toString calls in environments using the VEGA_DEBUG global variable. BORJIE never sets VEGA_DEBUG in production; the C3 generative-UI pipeline emits server-validated Vega-Lite specs that ajv-check before render, and the LLM never reaches the expression-builder surface. vega 6.x is a major version with a different rendering pipeline; sticking with 5.x until upstream lands a 5.x backport or we plan the 6.x migration. wave-L audit 2026-05-17 re-confirmed mitigations.',
    tracked_in: 'Docs/DEP_HYGIENE.md (vega 6.x migration)',
    next_review: '2026-Q4',
  },
  {
    package: 'vega-expression',
    severity: ['high'],
    fix: '>=5.2.1',
    reason:
      'GHSA-7f2v-3qq3-vvjf: Same advisory as vega — XSS via expressions abusing toString with VEGA_DEBUG. Same mitigation: VEGA_DEBUG never set in production; LLM never reaches expression surface (server-emitted, ajv-validated specs only). wave-L audit 2026-05-17 re-confirmed mitigations.',
    tracked_in: 'Docs/DEP_HYGIENE.md (vega 6.x migration)',
    next_review: '2026-Q4',
  },
  {
    package: 'vega-functions',
    severity: ['high'],
    fix: '>=6.1.1',
    reason:
      'GHSA-m9rg-mr6g-75gm: vega-functions XSS via setdata function. The C3 generative-UI pipeline server-emits Vega-Lite specs that ajv-validate against the v5 JSON schema BEFORE render. The LLM never reaches client-side setdata — setdata is invoked only by the Vega runtime against server-controlled data payloads. setdata-XSS requires attacker-controlled data injection into a setdata call site, which doesn\'t exist in our pipeline. wave-L audit 2026-05-17 re-confirmed mitigations.',
    tracked_in: 'Docs/DEP_HYGIENE.md (vega 6.x migration)',
    next_review: '2026-Q4',
  },
  {
    package: 'fastify',
    severity: ['high'],
    fix: '>=5.7.2',
    reason:
      'GHSA-jx2c-rxcm-jvmq: Fastify Content-Type header tab-character validation bypass. Six internal services pin fastify ^4.27.0 (sleep-pass-orchestrator, parcel-service, onboarding-orchestrator, outcomes-metering, field-capture-service, voice-agent). All six are internal-only — they sit behind the api-gateway BFF and only accept service-to-service traffic with the agent-platform JWT, never raw public Content-Type headers. Fix lands in fastify 5.7.2; fastify 4 → 5 is a major-version migration (Node 20 baseline + error-handler signature changes) deferred to its own PR.',
    tracked_in: 'Docs/DEP_HYGIENE.md (fastify 5.x migration)',
    next_review: '2026-Q3',
  },
];

function isAllowlisted(advisory) {
  for (const entry of ALLOWLIST) {
    if (
      advisory.module_name === entry.package &&
      entry.severity.includes(advisory.severity) &&
      (advisory.patched_versions === entry.fix ||
        (advisory.fixed_in || '') === entry.fix)
    ) {
      return entry;
    }
  }
  return null;
}

let auditOutput;
try {
  auditOutput = execSync('pnpm audit --json', {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
} catch (err) {
  // pnpm audit exits non-zero when there are advisories — that's
  // expected. We parse stdout regardless.
  auditOutput = err.stdout?.toString() || '';
}

let data;
try {
  data = JSON.parse(auditOutput);
} catch {
  console.error('Failed to parse pnpm audit output as JSON');
  console.error(auditOutput.slice(0, 500));
  process.exit(2);
}

const advisories = Object.values(data.advisories ?? {});
const counts = data.metadata?.vulnerabilities ?? {};
const totalBlocking = (counts.high ?? 0) + (counts.critical ?? 0);

console.log('## pnpm audit summary');
console.log(JSON.stringify(counts, null, 2));
console.log();

const seen = new Set();
const blocking = [];
const accepted = [];
for (const adv of advisories) {
  const sev = adv.severity;
  if (sev !== 'high' && sev !== 'critical') continue;
  const key = `${adv.module_name}|${sev}|${adv.patched_versions || adv.fixed_in || ''}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const allowed = isAllowlisted(adv);
  if (allowed) accepted.push({ adv, entry: allowed });
  else blocking.push(adv);
}

if (accepted.length > 0) {
  console.log('## Accepted (allowlisted) high+ advisories');
  for (const { adv, entry } of accepted) {
    console.log(
      `  - ${adv.severity.toUpperCase()} ${adv.module_name} (fix ${entry.fix}): ${entry.reason.slice(0, 100)}…`,
    );
    console.log(`    Tracked in: ${entry.tracked_in}`);
    console.log(`    Next review: ${entry.next_review}`);
  }
  console.log();
}

if (blocking.length > 0) {
  console.log('## ❌ BLOCKING high+ advisories (not in allowlist)');
  for (const adv of blocking) {
    console.log(
      `  - ${adv.severity.toUpperCase()} ${adv.module_name}: ${adv.title}`,
    );
    console.log(
      `    Vulnerable: ${adv.vulnerable_versions}  → fix: ${adv.patched_versions || adv.fixed_in}`,
    );
    console.log(`    Advisory: ${adv.url || adv.references || ''}`);
  }
  process.exit(1);
}

console.log(
  `✅ All high+ advisories are allowlisted (${accepted.length} accepted, 0 blocking).`,
);
console.log(
  `   Moderate: ${counts.moderate ?? 0}, Low: ${counts.low ?? 0} — informational.`,
);
process.exit(0);
