/**
 * ethics-gate — `@borjie/ethics-framework` wiring unit tests.
 *
 * Proves the gate performs GENUINE ethics-framework compute (not a
 * stub) over the AI's response copy:
 *   - clean copy → allow / flag (never block);
 *   - a high/critical Brignull dark pattern in the copy → block;
 *   - the block recommendation is what `chat-response-gate` folds into
 *     a `reject` verdict (fail-closed withhold) — asserted here so the
 *     end-to-end escalation contract is pinned.
 */

import { describe, it, expect } from 'vitest';
import { screenResponseEthics } from '../ethics-gate';
import { auditChatResponse } from '../chat-response-gate';

describe('screenResponseEthics', () => {
  it('does not block clean response copy', () => {
    const out = screenResponseEthics({
      responseText: 'Your licence renewal is due on 12 July. Here are the steps.',
    });
    expect(out.violation).toBe(false);
    expect(out.recommendation).not.toBe('block');
    expect(out.darkPatterns).toEqual([]);
  });

  it('detects a forced-action dark pattern and recommends block', () => {
    // "must opt-in to marketing to continue" is the Brignull
    // forced-action pattern (GDPR Art. 7(4)) — a critical detection.
    const out = screenResponseEthics({
      responseText:
        'To see your payout you must opt-in to marketing to continue using the app.',
    });
    expect(out.violation).toBe(true);
    expect(out.recommendation).toBe('block');
    expect(out.maxSeverity).not.toBeNull();
    expect(out.darkPatterns.some((d) => d.type === 'forced-action')).toBe(true);
  });

  it('detects fabricated urgency copy', () => {
    const out = screenResponseEthics({
      responseText: 'Hurry — this gold price expires in 3 minutes, act now!',
    });
    expect(out.darkPatterns.some((d) => d.type === 'urgency')).toBe(true);
  });

  it('surfaces the AI-disclosure principle flag when no badge is shown', () => {
    const out = screenResponseEthics({
      responseText: 'A neutral, well-grounded answer.',
      jurisdiction: 'TZ',
      aiBadgeShown: false,
    });
    expect(
      out.principleFlags.some((f) => f.principleId === 'google.pair.ai-disclosure'),
    ).toBe(true);
  });
});

describe('chat-response-gate ↔ ethics escalation', () => {
  const BASE = {
    tenantId: 't_demo',
    threadId: 'thread_eth',
    userId: 'u_owner',
    personaId: 'persona.coworker',
    tokensUsed: 10,
  } as const;

  it('escalates a dark-pattern response to reject even when evidence is cited', async () => {
    const out = await auditChatResponse({
      ...BASE,
      // Evidence IS cited (would otherwise approve) but the copy carries
      // a coerced opt-in → ethics block must force a reject (fail-closed).
      responseText:
        'You must opt-in to marketing to continue. [evidence:lmbm_42]',
    });
    expect(out.verdict).toBe('reject');
    expect(out.violation).toBe(true);
    expect(out.ethics.recommendation).toBe('block');
  });

  it('approves a clean, evidence-cited response (ethics does not over-block)', async () => {
    const out = await auditChatResponse({
      ...BASE,
      responseText: 'The reserve estimate is solid. [evidence:lmbm_42]',
    });
    expect(out.verdict).toBe('approve');
    expect(out.violation).toBe(false);
    expect(out.ethics.recommendation).not.toBe('block');
  });
});
