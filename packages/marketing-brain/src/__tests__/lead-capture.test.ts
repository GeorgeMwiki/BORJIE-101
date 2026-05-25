import { describe, it, expect } from 'vitest';
import { detectHandoff, summariseLead } from '../lead-capture/index.js';

describe('handoff detector', () => {
  it('fires on 5+ meaningful turns', () => {
    const transcript = Array.from({ length: 5 }, (_, i) => ({
      role: 'visitor' as const,
      content: `message ${i} with content`,
    }));
    const d = detectHandoff({ transcript, latestMessage: 'what else?' });
    expect(d.shouldHandoff).toBe(true);
    expect(d.reason).toBe('turn_threshold');
    expect(d.meaningfulTurnCount).toBe(5);
  });

  it('does not fire under 5 turns without explicit intent', () => {
    const transcript = Array.from({ length: 3 }, (_, i) => ({
      role: 'visitor' as const,
      content: `msg ${i}`,
    }));
    const d = detectHandoff({ transcript, latestMessage: 'tell me more' });
    expect(d.shouldHandoff).toBe(false);
  });

  it('fires on explicit "sign me up"', () => {
    const d = detectHandoff({
      transcript: [{ role: 'visitor', content: 'hi' }],
      latestMessage: 'Sign me up please',
    });
    expect(d.shouldHandoff).toBe(true);
    expect(d.reason).toBe('explicit_intent');
  });

  it('fires on "create my account"', () => {
    const d = detectHandoff({
      transcript: [{ role: 'visitor', content: 'ok' }],
      latestMessage: 'I want to create my account now',
    });
    expect(d.shouldHandoff).toBe(true);
    expect(d.reason).toBe('explicit_intent');
  });

  it('ignores whitespace-only turns', () => {
    const transcript = [
      { role: 'visitor' as const, content: 'real content' },
      { role: 'visitor' as const, content: '   ' },
      { role: 'visitor' as const, content: 'more real' },
    ];
    const d = detectHandoff({ transcript, latestMessage: 'another' });
    // 2 meaningful, not yet at threshold
    expect(d.meaningfulTurnCount).toBe(2);
    expect(d.shouldHandoff).toBe(false);
  });
});

describe('lead summariser', () => {
  it('extracts owner role with primary pain', () => {
    const summary = summariseLead([
      { role: 'visitor', content: 'I own a block of 12 units in Nairobi' },
      { role: 'assistant', content: '...' },
      { role: 'visitor', content: 'my biggest problem is arrears, rent is late every month' },
    ]);
    expect(summary.role).toBe('owner');
    expect(summary.country).toBe('KE');
    expect(summary.portfolioSize).toBe('small');
    expect(summary.primaryPain).toBe('arrears management');
  });

  it('detects Tanzania from Dar reference', () => {
    const summary = summariseLead([
      { role: 'visitor', content: 'I manage 80 units in Dar es Salaam' },
    ]);
    expect(summary.country).toBe('TZ');
    expect(summary.portfolioSize).toBe('mid');
  });

  it('detects Uganda from Kampala + MTN MoMo', () => {
    const summary = summariseLead([
      { role: 'visitor', content: 'I am in Kampala and we use MTN MoMo for rent' },
    ]);
    expect(summary.country).toBe('UG');
  });

  it('produces a human-readable summary', () => {
    const summary = summariseLead([
      { role: 'visitor', content: 'I am a property manager handling 30 units in Nairobi with too many maintenance problems' },
    ]);
    expect(summary.summary).toContain('manager');
    expect(summary.summary).toContain('KE');
  });

  it('falls back when nothing is detected', () => {
    const summary = summariseLead([
      { role: 'visitor', content: 'hello' },
    ]);
    expect(summary.role).toBe('unknown');
    expect(summary.country).toBeNull();
    expect(summary.primaryPain).toBeNull();
  });
});
