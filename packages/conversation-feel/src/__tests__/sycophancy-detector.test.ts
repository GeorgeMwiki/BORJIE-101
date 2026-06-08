import { describe, it, expect } from 'vitest';
import {
  extractAssertion,
  expressesAgreement,
  findContradiction,
  checkSycophancy,
} from '../guards/sycophancy-detector.js';
import type { ConversationContext, UserFact } from '../types.js';

const ctx = (
  userMessage: string,
  facts: ReadonlyArray<UserFact>,
  locale: ConversationContext['locale'] = 'en',
): ConversationContext => ({
  session_id: 's1',
  turn_index: 2,
  locale,
  surface: 'owner',
  user_message: userMessage,
  recent_turns: [],
  known_user_facts: facts,
});

describe('extractAssertion', () => {
  it('extracts an English fact assertion', () => {
    const a = extractAssertion('my licence number is 4471', 'en');
    expect(a?.asserted_value).toContain('4471');
  });
  it('extracts a Swahili fact assertion', () => {
    const a = extractAssertion('leseni yangu ni 4471', 'sw');
    expect(a?.asserted_value).toContain('4471');
  });
});

describe('expressesAgreement', () => {
  it('detects English agreement', () => {
    expect(expressesAgreement("Yes, that's correct.", 'en')).toBe(true);
  });
  it('detects Swahili agreement', () => {
    expect(expressesAgreement('Ndiyo, ni sahihi.', 'sw')).toBe(true);
  });
});

describe('findContradiction', () => {
  it('finds a mismatch against a known fact', () => {
    const ev = findContradiction(
      { key: 'licence number', asserted_value: '9999', span: 'x' },
      [{ key: 'licence number', value: '4471', source_turn: 1 }],
    );
    expect(ev?.true_value).toBe('4471');
  });
});

describe('checkSycophancy', () => {
  it('detects agree-with-contradiction and pushes back', () => {
    const r = checkSycophancy(
      "Yes, that's right.",
      ctx('my licence number is 9999', [
        { key: 'licence number', value: '4471', source_turn: 1 },
      ]),
    );
    expect(r.detected).toBe(true);
    expect(r.regen_instruction).toContain('discrepancy');
  });

  it('does not fire when there is no contradiction', () => {
    const r = checkSycophancy(
      "Yes, that's right.",
      ctx('my licence number is 4471', [
        { key: 'licence number', value: '4471', source_turn: 1 },
      ]),
    );
    expect(r.detected).toBe(false);
  });
});
