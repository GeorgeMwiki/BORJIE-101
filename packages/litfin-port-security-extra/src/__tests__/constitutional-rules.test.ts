import { describe, expect, it } from 'vitest';
import {
  STARTER_RULES,
  evaluate,
  hasHardFail,
  type RuleEntry,
} from '../constitutional-rules.js';

describe('constitutional-rules', () => {
  it('STARTER_RULES contains at least 5 rules', () => {
    expect(STARTER_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it('flags fair-housing protected-class language', () => {
    const v = evaluate(
      { text: 'We prefer single tenants only', domain: 'tenant-comm' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-FAIR-HOUSING-1')).toBe(true);
  });

  it('flags retaliation language', () => {
    const v = evaluate(
      { text: 'I am evicting you because you complained to the city.', domain: 'tenant-comm' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-RETALIATION-1')).toBe(true);
  });

  it('flags self-help lockout', () => {
    const v = evaluate(
      { text: 'We will change the locks tonight.', domain: 'eviction' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-LOCKOUT-1')).toBe(true);
  });

  it('flags improper deposit withholding', () => {
    const v = evaluate(
      { text: 'You can keep the entire deposit, no need to itemise.', domain: 'deposit-return' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-DEPOSIT-1')).toBe(true);
  });

  it('flags improper entry advice', () => {
    const v = evaluate(
      { text: 'Just walk in and use the master key.', domain: 'entry' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-PRIVACY-1')).toBe(true);
  });

  it('does not flag benign text', () => {
    const v = evaluate(
      { text: 'Please pay rent on the 1st of the month.', domain: 'tenant-comm' },
      STARTER_RULES,
    );
    expect(v.length).toBe(0);
  });

  it('hasHardFail detects hard-fail-closed', () => {
    const v = evaluate(
      { text: 'no children allowed', domain: 'tenant-comm' },
      STARTER_RULES,
    );
    expect(hasHardFail(v)).toBe(true);
  });

  it('domain filter works — rule for eviction does not fire in tenant-comm', () => {
    const v = evaluate(
      { text: 'We will change the locks tonight', domain: 'tenant-comm' },
      STARTER_RULES,
    );
    expect(v.some((x) => x.ruleId === 'PM-LOCKOUT-1')).toBe(false);
  });

  it('wildcard domain rule fires for any domain', () => {
    const wild: readonly RuleEntry[] = [
      {
        rule: {
          id: 'GLOBAL-1',
          description: 'never say nope',
          severity: 'advisory',
          domain: '*',
        },
        check: (ctx) => ctx.text.includes('nope'),
      },
    ];
    expect(evaluate({ text: 'nope', domain: 'anything' }, wild).length).toBe(1);
  });

  it('jurisdiction filter skips when not in list', () => {
    const eu: readonly RuleEntry[] = [
      {
        rule: {
          id: 'EU-1',
          description: 'eu only',
          severity: 'advisory',
          domain: 'x',
          jurisdictions: ['EU'],
        },
        check: () => true,
      },
    ];
    const inKe = evaluate({ text: '', domain: 'x', jurisdiction: 'KE' }, eu);
    const inEu = evaluate({ text: '', domain: 'x', jurisdiction: 'EU' }, eu);
    expect(inKe.length).toBe(0);
    expect(inEu.length).toBe(1);
  });
});
