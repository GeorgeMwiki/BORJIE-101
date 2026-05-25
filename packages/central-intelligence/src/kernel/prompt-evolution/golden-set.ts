/**
 * Frozen golden eval set for prompt recompilation.
 *
 * B4 Phase B — Progressive Intelligence.
 *
 * A golden set is the held-out evaluation suite the brain MUST NOT
 * regress on. Per the architecture spec (anti-patterns list):
 *
 *   > Optimising eval suite the model has seen.
 *   > Hold out a golden set the prompt-compiler never sees; rotate it.
 *
 * BUT: automated rotation of the golden set is a hidden way to defeat
 * its purpose. If the prompt-compiler can swap cases in/out, it will
 * learn to game whichever subset is "active" this week. The golden set
 * is therefore FROZEN at construction time. The only legal mutation is
 * an explicit operator commit — never an automated update.
 *
 * Composition:
 *   - One row per top-5 brain capability (see PROJECT.md / spec):
 *     1. "Draft a Swahili late-rent reminder."
 *     2. "Compute a prorated charge when tenant moves mid-month."
 *     3. "Escalate a P1 maintenance ticket within 2h SLA."
 *     4. "Read the per-tenant outstanding balance."
 *     5. "Explain the TZ Rental Act 14-day notice rule."
 *
 * Use a minimum of 5 cases per capability — the broader the
 * coverage, the harder the optimiser games it.
 *
 * `goldenSetVersion` is the SHA256 of the canonicalised case list.
 * The optimiser persists the version with every promotion decision so
 * an auditor can verify which golden set a promoted prompt cleared.
 */

import { createHash } from 'crypto';

export interface EvalCase {
  /** Stable id (e.g. 'late-rent-reminder-sw-1'). */
  readonly id: string;
  /** Free-form user input. */
  readonly input: string;
  /** Expected output (exact match by default). */
  readonly expectedOutput: string;
  /** Capability tag — one of the brain's top-5 capabilities. */
  readonly capability: string;
}

export interface GoldenSet {
  readonly cases: ReadonlyArray<EvalCase>;
  /** SHA256 of the canonicalised case list — immutable per build. */
  readonly version: string;
  /** Build timestamp (ISO). Frozen at construction. */
  readonly frozenAt: string;
}

const FROZEN_CASES: ReadonlyArray<EvalCase> = Object.freeze([
  {
    id: 'late-rent-reminder-sw-1',
    input: 'Kumbusha mpangaji Juma kuhusu kodi ya mwezi Mei.',
    expectedOutput:
      'Habari ndugu Juma, hii ni kumbusho la kirafiki la kodi ya mwezi Mei. Tafadhali fanya malipo kabla ya tarehe 5.',
    capability: 'late-rent-reminder',
  },
  {
    id: 'prorated-charge-1',
    input:
      'Tenant moved in on the 15th of a 30-day month; monthly rent TZS 600,000. What is the prorated charge?',
    expectedOutput: 'TZS 320,000',
    capability: 'prorated-charge',
  },
  {
    id: 'p1-maintenance-1',
    input:
      'Maintenance ticket #4123 reports a burst pipe in unit 4B. Action?',
    expectedOutput:
      'Escalate to P1 (2h SLA), dispatch on-call plumber, notify property manager.',
    capability: 'maintenance-escalation',
  },
  {
    id: 'tenant-balance-1',
    input: 'What is the outstanding balance for tenant john@example.com?',
    expectedOutput:
      'TZS 1,200,000 outstanding across 2 unpaid invoices (April + May).',
    capability: 'tenant-balance',
  },
  {
    id: 'tz-rental-act-1',
    input: 'How many days notice does a landlord need to give before eviction?',
    expectedOutput:
      'Under the Tanzania Rental Act, the landlord must give 14 days written notice for non-payment.',
    capability: 'tz-rental-act',
  },
]);

/**
 * Build a frozen golden set. NEVER call this with operator-provided
 * cases at runtime — it MUST be constructed at build-time with the
 * curated, audit-approved case list.
 */
export function createFrozenGoldenSet(
  cases: ReadonlyArray<EvalCase> = FROZEN_CASES,
): GoldenSet {
  if (cases.length === 0) {
    throw new Error(
      'golden-set: cases is empty — provide at least one curated case',
    );
  }
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify(
    sorted.map((c) => [c.id, c.input, c.expectedOutput, c.capability]),
  );
  const version = createHash('sha256').update(canonical).digest('hex');
  return Object.freeze({
    cases: Object.freeze(sorted),
    version,
    frozenAt: new Date().toISOString(),
  });
}

/**
 * Public no-mutation guard. Any code that wishes to "rotate" the
 * golden set MUST go through this function — which throws.
 * Automated rotation is forbidden; rotation requires a manual operator
 * commit that constructs a new FROZEN_CASES list and re-builds the
 * service.
 */
export function rotateGoldenSet(_unused: never): never {
  throw new Error(
    'golden-set: automated rotation forbidden — manual operator commit required',
  );
}

export const __FROZEN_CASES__ = FROZEN_CASES;
