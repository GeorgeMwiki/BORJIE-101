import { describe, it, expect } from 'vitest';
import {
  ConversationStateMachine,
  ContextManager,
  detectTone,
  extractEntities,
  generateGreeting,
  resumeDecision,
} from '../../conversation-state/index.js';

const T1 = 'tenant_alpha';
const U1 = 'user_one';

function makeMachine(lang: 'en' | 'sw' = 'en') {
  return new ConversationStateMachine({
    id: 'conv_1',
    tenantId: T1,
    userId: U1,
    language: lang,
  });
}

describe('ConversationStateMachine: transitions', () => {
  it('starts in greeting phase', () => {
    const m = makeMachine();
    expect(m.getState().phase).toBe('greeting');
  });

  it('greeting \u2192 discovery after first assistant turn', () => {
    const m = makeMachine();
    m.appendTurn({ role: 'assistant', text: 'Habari, how can I help?' });
    expect(m.getState().phase).toBe('discovery');
  });

  it('greeting \u2192 task directly if user states a task intent', () => {
    const m = makeMachine();
    m.appendTurn({ role: 'user', text: 'Please draft a notice for unit B-12' });
    expect(m.getState().phase).toBe('task');
  });

  it('discovery \u2192 task when user provides an entity', () => {
    const m = makeMachine();
    m.appendTurn({ role: 'assistant', text: 'Hi' });
    m.appendTurn({
      role: 'user',
      text: 'prop_ABC123',
      entities: [
        { type: 'property_id', value: 'ABC123', confidence: 0.9 },
      ],
    });
    expect(m.getState().phase).toBe('task');
  });

  it('task \u2192 wrap_up on thanks', () => {
    const m = makeMachine();
    m.forcePhase('task');
    m.appendTurn({ role: 'user', text: 'asante sana' });
    expect(m.getState().phase).toBe('wrap_up');
  });

  it('history is capped to maxHistoryTurns', () => {
    const m = new ConversationStateMachine({
      id: 'c',
      tenantId: T1,
      userId: U1,
      language: 'en',
      maxHistoryTurns: 3,
    });
    for (let i = 0; i < 5; i++) {
      m.appendTurn({ role: 'user', text: `msg ${i}` });
    }
    expect(m.getState().history).toHaveLength(3);
  });

  it('prevailingTone returns neutral when empty', () => {
    const m = makeMachine();
    expect(m.prevailingTone()).toBe('neutral');
  });
});

describe('ContextManager', () => {
  it('keeps recent turns verbatim', () => {
    const m = makeMachine();
    for (let i = 0; i < 20; i++) {
      m.appendTurn({ role: 'user', text: `m${i}` });
    }
    const cm = new ContextManager({ keepRecent: 5 });
    const snap = cm.snapshot(m.getState());
    expect(snap.recentTurns).toHaveLength(5);
    expect(snap.digest.length).toBeGreaterThan(0);
  });

  it('returns whole history as recent when small', () => {
    const m = makeMachine();
    m.appendTurn({ role: 'user', text: 'hi' });
    const cm = new ContextManager();
    const snap = cm.snapshot(m.getState());
    expect(snap.recentTurns).toHaveLength(1);
    expect(snap.digest).toBe('');
  });
});

describe('detectTone', () => {
  it('positive keywords lift score', () => {
    expect(detectTone({ message: 'thanks, this is great' })).toBe('positive');
  });
  it('negative keywords drop score', () => {
    expect(detectTone({ message: 'this is broken and confusing' })).toBe(
      'negative',
    );
  });
  it('neutral for empty-ish inputs', () => {
    expect(detectTone({ message: 'ok' })).toBe('neutral');
  });
  it('swahili keywords detected', () => {
    expect(detectTone({ message: 'asante sana, vizuri' })).toBe('positive');
  });
});

describe('extractEntities', () => {
  it('pulls property id', () => {
    const e = extractEntities('open prop_ABC123 please');
    expect(e.some((x) => x.type === 'property_id')).toBe(true);
  });
  it('pulls unit id', () => {
    const e = extractEntities('check unit B-12');
    expect(e.some((x) => x.type === 'unit_id')).toBe(true);
  });
  it('pulls TZS amounts', () => {
    const e = extractEntities('balance 1,200,000 TZS');
    expect(e.find((x) => x.type === 'amount_tzs')?.value).toBe('1200000');
  });
  it('pulls ISO dates', () => {
    const e = extractEntities('schedule on 2026-05-01');
    expect(e.find((x) => x.type === 'date')?.value).toBe('2026-05-01');
  });
  it('pulls district names', () => {
    const e = extractEntities('the Kinondoni portfolio');
    expect(e.some((x) => x.value === 'Kinondoni')).toBe(true);
  });
});

describe('generateGreeting', () => {
  it('English morning greeting', () => {
    const s = generateGreeting({
      language: 'en',
      now: new Date('2026-04-19T08:00:00'),
      user: { displayName: 'Mama Neema' },
    });
    expect(s.toLowerCase()).toContain('morning');
    expect(s).toContain('Mama Neema');
    expect(s).toContain('Mwikila');
  });
  it('Swahili morning greeting', () => {
    const s = generateGreeting({
      language: 'sw',
      now: new Date('2026-04-19T08:00:00'),
      user: { displayName: 'Mama Neema' },
    });
    expect(s.toLowerCase()).toContain('habari za asubuhi');
  });
  it('mentions open insight count when present', () => {
    const s = generateGreeting({
      language: 'en',
      now: new Date('2026-04-19T08:00:00'),
      user: { displayName: 'Test' },
      openInsightCount: 4,
    });
    expect(s).toMatch(/4/);
  });
});

describe('resumeDecision', () => {
  it('soft_continue within 6h', () => {
    const now = new Date('2026-04-19T08:00:00Z');
    const last = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const d = resumeDecision({
      language: 'en',
      now,
      user: { displayName: 'Test', lastSessionAt: last },
    });
    expect(d.mode).toBe('soft_continue');
  });
  it('warm_resume within 24h', () => {
    const now = new Date('2026-04-19T08:00:00Z');
    const last = new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const d = resumeDecision({
      language: 'en',
      now,
      user: {
        displayName: 'Test',
        lastSessionAt: last,
        lastFocus: 'Kinondoni portfolio',
      },
    });
    expect(d.mode).toBe('warm_resume');
    expect(d.message.toLowerCase()).toContain('kinondoni');
  });
  it('full_greeting after 24h', () => {
    const now = new Date('2026-04-19T08:00:00Z');
    const last = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const d = resumeDecision({
      language: 'en',
      now,
      user: { displayName: 'Test', lastSessionAt: last },
    });
    expect(d.mode).toBe('full_greeting');
  });
});
