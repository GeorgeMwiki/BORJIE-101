/**
 * Intent classifier — exhaustive unit tests.
 *
 * Determinism: same input → same verdict. We assert kind, confidence
 * thresholds, confirmation gates, and signal extraction.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  evaluateConfirmation,
  extractSignals,
} from '../intent/index.js';

describe('extractSignals', () => {
  it('extracts no signals from empty input', () => {
    expect(extractSignals('')).toEqual([]);
  });

  it('extracts a recurring-cadence signal from "every Monday"', () => {
    const signals = extractSignals('Every Monday at 9am send me a report.');
    expect(signals.some((s) => s.kind === 'recurring-cadence')).toBe(true);
  });

  it('extracts a conditional-trigger signal from "if my cash drops"', () => {
    const signals = extractSignals('If my cash drops below 2m, alert me.');
    expect(signals.some((s) => s.kind === 'conditional-trigger')).toBe(true);
  });

  it('extracts a question-marker signal from "what is"', () => {
    const signals = extractSignals('What is my arrears total?');
    expect(signals.some((s) => s.kind === 'question-marker')).toBe(true);
  });

  it('extracts an imperative-now signal from "send now"', () => {
    const signals = extractSignals('Send tenant John an SMS right now.');
    expect(signals.some((s) => s.kind === 'imperative-now')).toBe(true);
  });

  it('extracts a destructive-verb signal from "evict"', () => {
    const signals = extractSignals('If arrears > 60d, evict the tenant.');
    expect(signals.some((s) => s.kind === 'destructive-verb')).toBe(true);
  });

  it('extracts a self-reference signal from "send me"', () => {
    const signals = extractSignals('Send me a weekly brief.');
    expect(signals.some((s) => s.kind === 'recipient-self-reference')).toBe(true);
  });

  it('extracts Swahili recurring cadence from "kila Jumatatu"', () => {
    const signals = extractSignals('Kila Jumatatu nitumie ripoti.');
    expect(signals.some((s) => s.kind === 'recurring-cadence')).toBe(true);
  });

  it('extracts Swahili conditional from "ikiwa"', () => {
    const signals = extractSignals('Ikiwa mpangaji halipi, niambie.');
    expect(signals.some((s) => s.kind === 'conditional-trigger')).toBe(true);
  });

  it('returns a frozen array (immutable)', () => {
    const signals = extractSignals('Every Monday');
    expect(Object.isFrozen(signals)).toBe(true);
  });
});

describe('classifyIntent — recurring', () => {
  it('classifies "Every Monday morning send me a one-page brief" as recurring', () => {
    const v = classifyIntent('Every Monday morning send me a one-page brief on the previous week.');
    expect(v.kind).toBe('recurring');
    expect(v.compileEligible).toBe(true);
  });

  it('classifies "Every day at 8am, send me a snapshot" as recurring', () => {
    const v = classifyIntent('Every day at 8am, send me a snapshot of overnight tickets.');
    expect(v.kind).toBe('recurring');
  });

  it('classifies "on the 25th of every month" as recurring', () => {
    const v = classifyIntent('On the 25th of every month, chase tenants in arrears.');
    expect(v.kind).toBe('recurring');
  });

  it('classifies "weekly: review which tenants paid late" as recurring', () => {
    const v = classifyIntent('Weekly: review which tenants paid late.');
    expect(v.kind).toBe('recurring');
  });

  it('Swahili: "Kila Jumatatu nitumie ripoti" → recurring', () => {
    const v = classifyIntent('Kila Jumatatu nitumie ripoti ya wiki iliyopita.');
    expect(v.kind).toBe('recurring');
  });

  it('emits a confirmation prompt for mid-band recurring intent', () => {
    const v = classifyIntent('Every Monday morning send me a brief.');
    expect(v.confirmation).not.toBeNull();
    if (v.confirmation) {
      expect(v.confirmation.summary).toContain('recurring');
      expect(v.confirmation.approvalKeywords).toContain('yes');
      expect(v.confirmation.rejectionKeywords).toContain('no');
    }
  });
});

describe('classifyIntent — conditional', () => {
  it('classifies "if a lease ends in 60 days, draft renewal" as conditional', () => {
    const v = classifyIntent('If a lease ends in 60 days, draft a renewal offer.');
    expect(v.kind).toBe('conditional');
    expect(v.compileEligible).toBe(true);
  });

  it('classifies "when my cash drops" as conditional', () => {
    const v = classifyIntent('When my cash balance drops below 2m, alert me.');
    expect(v.kind).toBe('conditional');
  });

  it('classifies "whenever a tenant complaint" as conditional', () => {
    const v = classifyIntent('Whenever a tenant files a complaint, route it to maintenance.');
    expect(v.kind).toBe('conditional');
  });

  it('classifies "30 days before any lease expires" as conditional', () => {
    const v = classifyIntent('30 days before any lease expires, ping me about renewal pricing.');
    expect(v.kind).toBe('conditional');
  });

  it('Swahili: "Endapo mpangaji hajalipa" → conditional', () => {
    const v = classifyIntent('Endapo mpangaji hajalipa, nikumbushe.');
    expect(v.kind).toBe('conditional');
  });
});

describe('classifyIntent — ad-hoc', () => {
  it('classifies "send John an SMS now" as ad-hoc', () => {
    const v = classifyIntent('Send John an SMS now reminding him about the inspection.');
    expect(v.kind).toBe('ad-hoc');
    expect(v.compileEligible).toBe(false);
  });

  it('classifies "Please draft an email to the new tenant" as ad-hoc', () => {
    const v = classifyIntent('Please draft an email to the new tenant in unit 4B.');
    expect(v.kind).toBe('ad-hoc');
  });

  it('never sets a confirmation prompt for ad-hoc', () => {
    const v = classifyIntent('Send the email today.');
    expect(v.confirmation).toBeNull();
  });
});

describe('classifyIntent — question', () => {
  it('classifies "what is my arrears total?" as question', () => {
    const v = classifyIntent('What is my arrears total this month?');
    expect(v.kind).toBe('question');
    expect(v.compileEligible).toBe(false);
  });

  it('classifies "how many tenants are late?" as question', () => {
    const v = classifyIntent('How many tenants are late on their rent right now?');
    expect(v.kind).toBe('question');
  });

  it('classifies "show me the leases expiring" as question', () => {
    const v = classifyIntent('Show me the leases expiring next quarter.');
    expect(v.kind).toBe('question');
  });

  it('never sets a confirmation prompt for question', () => {
    const v = classifyIntent('What is the occupancy rate?');
    expect(v.confirmation).toBeNull();
  });
});

describe('classifyIntent — edge cases', () => {
  it('empty input → question with confidence 0', () => {
    const v = classifyIntent('');
    expect(v.kind).toBe('question');
    expect(v.confidence).toBe(0);
    expect(v.compileEligible).toBe(false);
  });

  it('whitespace-only input → question with confidence 0', () => {
    const v = classifyIntent('   \n\t  ');
    expect(v.confidence).toBe(0);
  });

  it('emits confidence in [0, 1]', () => {
    const v = classifyIntent('Every Monday at 7am, send me a brief.');
    expect(v.confidence).toBeGreaterThanOrEqual(0);
    expect(v.confidence).toBeLessThanOrEqual(1);
  });

  it('verdict is frozen', () => {
    const v = classifyIntent('Every Monday');
    expect(Object.isFrozen(v)).toBe(true);
  });

  it('skipConfirmationAt=0 → no confirmation prompt even for mid-band', () => {
    const v = classifyIntent('Every Monday send me a brief.', { skipConfirmationAt: 0 });
    expect(v.confirmation).toBeNull();
  });

  it('minCompileConfidence=0.99 → demotes recurring to ad-hoc', () => {
    const v = classifyIntent('Every Monday', { minCompileConfidence: 0.99 });
    expect(v.kind).toBe('ad-hoc');
    expect(v.compileEligible).toBe(false);
  });

  it('deterministic — same input twice returns identical verdict', () => {
    const a = classifyIntent('Every Monday at 7am send me a brief.');
    const b = classifyIntent('Every Monday at 7am send me a brief.');
    expect(a.kind).toBe(b.kind);
    expect(a.confidence).toBe(b.confidence);
    expect(a.compileEligible).toBe(b.compileEligible);
  });
});

describe('evaluateConfirmation', () => {
  const prompt = {
    summary: 's',
    plan: 'p',
    approvalKeywords: Object.freeze(['yes', 'y', 'go ahead', 'sawa']),
    rejectionKeywords: Object.freeze(['no', 'n', 'cancel', 'hapana']),
  } as const;

  it('treats "yes" as approval', () => {
    expect(evaluateConfirmation('yes', prompt)).toBe('approved');
  });

  it('treats "Yes!" as approval', () => {
    expect(evaluateConfirmation('Yes, go ahead', prompt)).toBe('approved');
  });

  it('treats "no" as rejection', () => {
    expect(evaluateConfirmation('no', prompt)).toBe('rejected');
  });

  it('treats "sawa" (Swahili yes) as approval', () => {
    expect(evaluateConfirmation('sawa', prompt)).toBe('approved');
  });

  it('treats "hapana" (Swahili no) as rejection', () => {
    expect(evaluateConfirmation('hapana', prompt)).toBe('rejected');
  });

  it('treats unrelated text as ambiguous', () => {
    expect(evaluateConfirmation('maybe later', prompt)).toBe('ambiguous');
  });

  it('treats empty reply as ambiguous', () => {
    expect(evaluateConfirmation('', prompt)).toBe('ambiguous');
  });

  it('is case-insensitive', () => {
    expect(evaluateConfirmation('GO AHEAD', prompt)).toBe('approved');
  });
});
