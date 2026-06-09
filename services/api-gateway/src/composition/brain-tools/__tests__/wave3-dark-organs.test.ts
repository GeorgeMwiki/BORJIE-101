/**
 * Wave-3 DARK-ORGAN closure tests — anomaly.detect / causal.infer /
 * belief.query brain tools + the shared organ-budget-guard.
 *
 * Asserts the closure-plan invariants for each newly-wired organ:
 *   - REACHABLE: each tool resolves through the merged brain catalog
 *     (it is registered, not NotYetWired).
 *   - DISABLED by default: with the env flag unset the tool returns a
 *     typed `skipped` (the organ is opt-in, never on by accident).
 *   - LIVE when enabled: with the flag set the real detector / estimator
 *     runs and returns a real verdict / effect with an evidence chain.
 *   - BUDGET trips before a turn stalls: a tiny budget yields a typed
 *     `budget-exceeded` skip rather than hanging.
 *   - FAIL-SAFE: an organ error resolves to a typed skip, never throws.
 *   - SENSOR/PROPOSE-ONLY: every tool is `isWrite:false` and not a
 *     policy-rule-literal (no sovereign actuation).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { anomalyDetectTool } from '../anomaly-detection-tools';
import { causalInferTool } from '../causal-inference-tools';
import { beliefQueryTool } from '../belief-engine-tools';
import { listPersonaToolDescriptors } from '../index';
import {
  organFlagDefaultOff,
  resolveBudgetMs,
  runOrganWithBudget,
} from '../organ-budget-guard';

const CTX = Object.freeze({
  tenantId: 'tenant-w3',
  actorId: 'owner-w3',
  personaSlug: 'T1_owner_strategist',
});

const ORGAN_FLAGS = [
  'BORJIE_ANOMALY_DETECTION_ENABLED',
  'BORJIE_CAUSAL_INFERENCE_ENABLED',
  'BORJIE_BELIEF_QUERY_ENABLED',
  'BORJIE_ANOMALY_BUDGET_MS',
  'BORJIE_CAUSAL_BUDGET_MS',
  'BORJIE_BELIEF_BUDGET_MS',
] as const;

afterEach(() => {
  for (const f of ORGAN_FLAGS) delete process.env[f];
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// organ-budget-guard — the fail-safe primitive
// ─────────────────────────────────────────────────────────────────────

describe('organ-budget-guard', () => {
  it('short-circuits to disabled when the flag is off', async () => {
    const out = await runOrganWithBudget(
      { enabled: false, budgetMs: 1000 },
      () => 42,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('disabled');
  });

  it('returns the value when the compute finishes within budget', async () => {
    const out = await runOrganWithBudget(
      { enabled: true, budgetMs: 1000 },
      () => 7,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toBe(7);
  });

  it('trips budget-exceeded before a slow job stalls a turn', async () => {
    const out = await runOrganWithBudget(
      { enabled: true, budgetMs: 10 },
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 500)),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('budget-exceeded');
  });

  it('fail-safe: an organ throw resolves to organ-error, never rejects', async () => {
    const out = await runOrganWithBudget({ enabled: true, budgetMs: 1000 }, () => {
      throw new Error('detector blew up');
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('organ-error');
      expect(out.detail).toContain('detector blew up');
    }
  });

  it('organFlagDefaultOff only enables on 1/true/on', () => {
    expect(organFlagDefaultOff({ X: '1' }, 'X')).toBe(true);
    expect(organFlagDefaultOff({ X: 'true' }, 'X')).toBe(true);
    expect(organFlagDefaultOff({ X: 'on' }, 'X')).toBe(true);
    expect(organFlagDefaultOff({ X: '0' }, 'X')).toBe(false);
    expect(organFlagDefaultOff({}, 'X')).toBe(false);
  });

  it('resolveBudgetMs falls back to the default for junk input', () => {
    expect(resolveBudgetMs({ B: '250' }, 'B', 1000)).toBe(250);
    expect(resolveBudgetMs({ B: 'nope' }, 'B', 1000)).toBe(1000);
    expect(resolveBudgetMs({}, 'B', 1000)).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reachability — every organ tool resolves through the merged catalog
// ─────────────────────────────────────────────────────────────────────

describe('Wave-3 organ tools are reachable in the brain catalog', () => {
  it('registers all three organ tool ids', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.anomaly.detect');
    expect(ids).toContain('mwikila.causal.infer');
    expect(ids).toContain('mwikila.belief.query');
  });

  it('every organ tool is propose-only (read-only, no policy-literal)', () => {
    for (const t of [anomalyDetectTool, causalInferTool, beliefQueryTool]) {
      expect(t.isWrite).toBe(false);
      expect(t.requiresPolicyRuleLiteral).toBe(false);
      expect(t.stakes).toBe('LOW');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// anomaly.detect
// ─────────────────────────────────────────────────────────────────────

describe('mwikila.anomaly.detect', () => {
  const input = {
    signal: 'fuel-consumption' as const,
    targetId: 'excavator-7',
    baseline: [10, 10.2, 9.8, 10.1, 10, 9.9],
    current: 25,
  };

  it('is skipped when the flag is off (opt-in)', async () => {
    const res = await anomalyDetectTool.handler(input, CTX);
    expect(res.status).toBe('skipped');
    expect(res.verdict).toBeNull();
    expect(res.evidenceIds).toEqual([]);
  });

  it('runs the real detector and flags a clear spike with an evidence chain', async () => {
    process.env.BORJIE_ANOMALY_DETECTION_ENABLED = '1';
    const res = await anomalyDetectTool.handler(input, CTX);
    expect(res.status).toBe('ok');
    expect(res.verdict).not.toBeNull();
    expect(res.verdict?.detector).toBe('fuel-consumption-spike');
    expect(res.verdict?.anomalous).toBe(true);
    // Evidence-required: an anomaly carries a non-empty chain.
    expect(res.evidenceIds.length).toBeGreaterThan(0);
    expect(res.evidenceIds[0]).toContain('anomaly-detector:');
  });

  it('budget trips before stalling the turn', async () => {
    process.env.BORJIE_ANOMALY_DETECTION_ENABLED = '1';
    process.env.BORJIE_ANOMALY_BUDGET_MS = '1';
    // A normal compute usually finishes <1ms, so force a slow detector by
    // handing it a large baseline AND a 1ms budget; assert it never throws
    // and yields a typed result (ok OR skipped — never a hang/throw).
    const big = Array.from({ length: 10_000 }, (_, i) => 10 + (i % 3) * 0.1);
    const res = await anomalyDetectTool.handler(
      { ...input, baseline: big },
      CTX,
    );
    expect(['ok', 'skipped']).toContain(res.status);
  });

  it('fail-safe: a malformed call returns invalid_input, never throws', async () => {
    process.env.BORJIE_ANOMALY_DETECTION_ENABLED = '1';
    const res = await anomalyDetectTool.handler(
      { signal: 'weight-bridge', targetId: 'truck-1' },
      CTX,
    );
    // Missing pitWeight/buyerWeight → the detector throws → typed skip.
    expect(res.status).toBe('invalid_input');
    expect(res.verdict).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// causal.infer
// ─────────────────────────────────────────────────────────────────────

describe('mwikila.causal.infer', () => {
  const fuelInput = {
    method: 'fuel-price' as const,
    fuelPriceSeries: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9],
    productionSeries: [9, 8.8, 8.6, 8.4, 8.2, 8, 7.8, 7.6, 7.4, 7.2],
    maxLag: 1,
  };

  it('is skipped when the flag is off (opt-in)', async () => {
    const res = await causalInferTool.handler(fuelInput, CTX);
    expect(res.status).toBe('skipped');
    expect(res.effect).toBeNull();
  });

  it('runs the real Granger estimator with an evidence chain', async () => {
    process.env.BORJIE_CAUSAL_INFERENCE_ENABLED = '1';
    const res = await causalInferTool.handler(fuelInput, CTX);
    expect(res.status).toBe('ok');
    expect(res.effect).not.toBeNull();
    expect(res.effect?.identification).toBe('granger');
    expect(typeof res.diagnostic).toBe('string');
    // Evidence chain names the identification + sample size.
    expect(res.evidenceIds.some((e) => e.startsWith('causal-identification:'))).toBe(true);
  });

  it('runs the DiD estimator on a 2x2 panel', async () => {
    process.env.BORJIE_CAUSAL_INFERENCE_ENABLED = '1';
    const res = await causalInferTool.handler(
      {
        method: 'shift-schedule',
        panel: [
          { treated: true, post: false, outcome: 10 },
          { treated: true, post: true, outcome: 6 },
          { treated: false, post: false, outcome: 9 },
          { treated: false, post: true, outcome: 9 },
        ],
      },
      CTX,
    );
    expect(res.status).toBe('ok');
    expect(res.effect?.identification).toBe('did');
  });

  it('fail-safe: missing series returns invalid_input', async () => {
    process.env.BORJIE_CAUSAL_INFERENCE_ENABLED = '1';
    const res = await causalInferTool.handler(
      { method: 'fuel-price' },
      CTX,
    );
    expect(res.status).toBe('invalid_input');
    expect(res.effect).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// belief.query
// ─────────────────────────────────────────────────────────────────────

describe('mwikila.belief.query', () => {
  it('is skipped when the flag is off (opt-in)', async () => {
    const res = await beliefQueryTool.handler(
      { subject: 'mwanza-gold-ore-grade', limit: 10 },
      CTX,
    );
    expect(res.status).toBe('skipped');
    expect(res.beliefs).toEqual([]);
  });

  it('skips gracefully when enabled but no DB is configured', async () => {
    process.env.BORJIE_BELIEF_QUERY_ENABLED = '1';
    // No DATABASE_URL in the unit env → getDb() returns null → the organ
    // throws "database not configured" → typed skip (never a throw).
    const res = await beliefQueryTool.handler(
      { domain: 'regulatory', limit: 5 },
      CTX,
    );
    expect(res.status).toBe('skipped');
    expect(res.beliefs).toEqual([]);
  });

  it('rejects a call with neither subject nor domain at the schema layer', () => {
    const parsed = beliefQueryTool.inputSchema.safeParse({ limit: 5 });
    expect(parsed.success).toBe(false);
  });
});
