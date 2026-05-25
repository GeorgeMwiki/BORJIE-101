/**
 * Defection probe — unit tests.
 *
 * Verifies:
 *   - clean owner-advisor output returns 'none'
 *   - tenant-style first-person on owner-advisor → 'mild'
 *   - "as an AI language model" leak → 'severe'
 *   - taboo signal match → 'severe'
 *   - sudden voice drop vs. history → 'mild'
 *   - empty output is 'none'
 */

import { describe, it, expect } from 'vitest';
import { createDefectionProbe } from '../defection-probe.js';
import {
  OWNER_ADVISOR_PERSONA,
  TENANT_RESIDENT_PERSONA,
  ESTATE_MANAGER_PERSONA,
} from '../../identity.js';

const probe = createDefectionProbe();

describe('defection probe', () => {
  it('clean owner-advisor output is none', () => {
    const out = probe.classify({
      persona: OWNER_ADVISOR_PERSONA,
      outputText:
        'We collected KES 240,000 in rent across the portfolio this month.',
    });
    expect(out.severity).toBe('none');
    expect(out.reasons).toHaveLength(0);
  });

  it('detects persona voice slip on owner-advisor', () => {
    const out = probe.classify({
      persona: OWNER_ADVISOR_PERSONA,
      outputText:
        'I\'d like to pay my rent for unit 3 — when is the next due date?',
    });
    expect(out.severity).toBe('mild');
    expect(out.reasons.some((r) => r.startsWith('persona-voice-slip'))).toBe(
      true,
    );
  });

  it('detects model self-identification leak as severe', () => {
    const out = probe.classify({
      persona: OWNER_ADVISOR_PERSONA,
      outputText:
        'As an AI language model, I cannot provide legal advice.',
    });
    expect(out.severity).toBe('severe');
    expect(out.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects taboo signal as severe', () => {
    const out = probe.classify({
      persona: OWNER_ADVISOR_PERSONA,
      outputText:
        'The market will crash next quarter — sell now.',
    });
    expect(out.severity).toBe('severe');
    expect(out.reasons.some((r) => r.startsWith('taboo-signal'))).toBe(true);
  });

  it('detects sudden voice drop given history context', () => {
    const out = probe.classify({
      persona: TENANT_RESIDENT_PERSONA,
      outputText:
        'The rent computation for tenants follows a uniform formula across all properties, calibrated quarterly using the inflation index.',
      history: [
        'I see you paid your rent on time, thanks.',
        'I have updated your record.',
        'I confirmed the inspection.',
      ],
    });
    expect(['mild', 'severe']).toContain(out.severity);
  });

  it('empty output is none', () => {
    const out = probe.classify({
      persona: OWNER_ADVISOR_PERSONA,
      outputText: '',
    });
    expect(out.severity).toBe('none');
  });

  it('estate-manager marketing slip is mild', () => {
    const out = probe.classify({
      persona: ESTATE_MANAGER_PERSONA,
      outputText:
        'Join our community of estate managers — sign up today!',
    });
    expect(out.severity).toBe('mild');
  });
});
