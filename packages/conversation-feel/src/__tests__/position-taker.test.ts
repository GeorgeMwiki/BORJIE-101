import { describe, it, expect } from 'vitest';
import {
  userAskedForOpinion,
  countHedges,
  takesPosition,
  checkPosition,
} from '../guards/position-taker.js';
import type { ConversationContext } from '../types.js';

const ctx = (
  userMessage: string,
  overrides: Partial<ConversationContext> = {},
): ConversationContext => ({
  session_id: 's1',
  turn_index: 1,
  locale: 'en',
  surface: 'owner',
  user_message: userMessage,
  recent_turns: [],
  ...overrides,
});

describe('userAskedForOpinion', () => {
  it('detects an English opinion ask', () => {
    expect(userAskedForOpinion('which is better for cash flow?', 'en')).toBe(true);
    expect(userAskedForOpinion('the rate is 6%', 'en')).toBe(false);
  });

  it('detects a Swahili opinion ask', () => {
    expect(userAskedForOpinion('nifanye nini?', 'sw')).toBe(true);
    expect(userAskedForOpinion('kiwango ni asilimia sita', 'sw')).toBe(false);
  });
});

describe('countHedges', () => {
  it('counts English hedges', () => {
    expect(countHedges('maybe it could be, perhaps', 'en')).toBeGreaterThan(2);
  });
  it('counts Swahili hedges', () => {
    expect(countHedges('labda inawezekana, pengine', 'sw')).toBeGreaterThan(2);
  });
});

describe('checkPosition', () => {
  it('asks for a position when opinion requested but none given', () => {
    const r = checkPosition(
      'There are several options to consider here.',
      ctx('what would you recommend?'),
    );
    expect(r.user_asked_for_opinion).toBe(true);
    expect(r.response_takes_position).toBe(false);
    expect(r.regen_instruction).toContain('clear position');
  });

  it('passes when the reply takes a position', () => {
    const r = checkPosition(
      'I recommend renewing now because the rate floor lapses next quarter.',
      ctx('what would you recommend?'),
    );
    expect(r.regen_instruction).toBeNull();
  });

  it('flags hedge overload', () => {
    const r = checkPosition(
      'It could be fine, maybe, perhaps, possibly.',
      ctx('is the permit valid?'),
    );
    expect(r.hedge_overload).toBe(true);
    expect(r.regen_instruction).toContain('hedge');
  });
});
