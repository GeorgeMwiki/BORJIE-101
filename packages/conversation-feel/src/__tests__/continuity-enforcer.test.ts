import { describe, it, expect } from 'vitest';
import {
  checkContinuity,
  recordFact,
  openThread,
} from '../continuity/continuity-enforcer.js';
import type { ConversationContext } from '../types.js';

const ctx = (
  candidateTurnIndex: number,
  recent: ConversationContext['recent_turns'],
): ConversationContext => ({
  session_id: 's1',
  turn_index: candidateTurnIndex,
  locale: 'en',
  surface: 'owner',
  user_message: recent.length > 0 ? (recent[recent.length - 1]?.content ?? '') : '',
  recent_turns: recent,
});

describe('checkContinuity', () => {
  it('passes turn 1 with no requirement', () => {
    const r = checkContinuity('Anything.', ctx(1, []));
    expect(r.has_continuity).toBe(true);
  });

  it('passes when the reply echoes a 3-word run from the user', () => {
    const r = checkContinuity(
      'The royalty rate question depends on gross value.',
      ctx(2, [
        { role: 'user', content: 'about the royalty rate', turn_index: 1 },
      ]),
    );
    expect(r.has_continuity).toBe(true);
    expect(r.anchor_kind).toBe('quote');
  });

  it('flags missing continuity and suggests an anchor', () => {
    const r = checkContinuity(
      'Generic boilerplate that ignores the user entirely here.',
      ctx(2, [
        {
          role: 'user',
          content: 'My Geita concession permit expires soon',
          turn_index: 1,
        },
      ]),
    );
    expect(r.has_continuity).toBe(false);
    expect(r.regen_instruction).toContain('Reference');
  });
});

describe('continuity session state builders are immutable', () => {
  it('recordFact returns a new state without mutating', () => {
    const s0 = { session_id: 's1', known_facts: [], open_threads: [] };
    const s1 = recordFact(s0, { key: 'k', value: 'v', source_turn: 1 });
    expect(s0.known_facts).toHaveLength(0);
    expect(s1.known_facts).toHaveLength(1);
  });

  it('openThread dedupes', () => {
    const s0 = { session_id: 's1', known_facts: [], open_threads: ['t'] };
    const s1 = openThread(s0, 't');
    expect(s1).toBe(s0);
  });
});
