import { describe, it, expect, beforeEach } from 'vitest';
import { runPreSendAudit } from '../style-audit/pre-send-audit.js';
import { verifyChain, _resetAuditLog } from '../audit-log.js';
import type { ConversationContext } from '../types.js';

const baseCtx = (
  overrides: Partial<ConversationContext> = {},
): ConversationContext => ({
  session_id: 'sess-1',
  turn_index: 1,
  locale: 'en',
  surface: 'owner',
  user_message: 'what is the royalty rate?',
  recent_turns: [],
  ...overrides,
});

beforeEach(() => {
  _resetAuditLog();
});

describe('runPreSendAudit', () => {
  it('strips filler and logs a tamper-evident intervention', async () => {
    const r = await runPreSendAudit(
      'Great question! The royalty is 6% of gross value.',
      baseCtx(),
    );
    expect(r.final).toBe('The royalty is 6% of gross value.');
    expect(r.interventions.length).toBeGreaterThan(0);
    expect(verifyChain('sess-1').ok).toBe(true);
  });

  it('requests a regen when an opinion was asked but not given', async () => {
    const r = await runPreSendAudit(
      'There are several options worth considering.',
      baseCtx({ user_message: 'what would you recommend?' }),
    );
    expect(r.regen_requested).toBe(true);
    expect(r.regen_instruction).toContain('position');
  });

  it('honors a regen callback replacement', async () => {
    const r = await runPreSendAudit(
      'There are several options worth considering.',
      baseCtx({ user_message: 'what would you recommend?' }),
      {
        request_regen_callback: async () =>
          'I recommend renewing now because the floor lapses next quarter.',
      },
    );
    expect(r.regen_requested).toBe(false);
    expect(r.final).toContain('I recommend renewing now');
  });

  it('swallows a throwing regen callback and keeps working text', async () => {
    const r = await runPreSendAudit(
      'There are several options worth considering.',
      baseCtx({ user_message: 'what would you recommend?' }),
      {
        request_regen_callback: async () => {
          throw new Error('model down');
        },
      },
    );
    expect(r.final).toContain('several options');
  });

  it('keeps a Swahili reply Swahili end-to-end', async () => {
    const r = await runPreSendAudit(
      'Swali zuri! Mrabaha ni asilimia sita ya thamani ghafi.',
      baseCtx({ locale: 'sw', user_message: 'nini kiwango cha mrabaha?' }),
    );
    expect(r.final).toBe('Mrabaha ni asilimia sita ya thamani ghafi.');
    expect(r.final).not.toMatch(/\b(great|question|sorry)\b/i);
  });
});
