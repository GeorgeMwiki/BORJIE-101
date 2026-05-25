/**
 * Chat prose helpers — confirmation + rejection + next-run hint.
 */

import { describe, expect, it } from 'vitest';
import {
  buildChatConfirmation,
  buildChatRejection,
  summariseNextRun,
} from '../compile/chat-prose.js';
import { LEASE_RENEWAL_AOP, WEEKLY_BRIEF_AOP } from './_helpers.js';

describe('summariseNextRun', () => {
  it('weekly Monday cron → "every Monday at 7am Africa/Nairobi"', () => {
    const hint = summariseNextRun(WEEKLY_BRIEF_AOP);
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/every Monday/);
    expect(hint).toMatch(/7am/);
    expect(hint).toMatch(/Africa\/Nairobi/);
  });

  it('event-triggered AOP → null', () => {
    expect(summariseNextRun(LEASE_RENEWAL_AOP)).toBeNull();
  });

  it('monthly day-25 cron prettifies correctly', () => {
    const aop = { ...WEEKLY_BRIEF_AOP, trigger: { kind: 'cron' as const, schedule: '0 9 25 * *', timezone: 'Africa/Nairobi' } };
    const hint = summariseNextRun(aop as typeof WEEKLY_BRIEF_AOP);
    expect(hint).toMatch(/day 25/);
  });
});

describe('buildChatConfirmation', () => {
  it('owner-customer scope says "your skill"', () => {
    const text = buildChatConfirmation({
      ast: WEEKLY_BRIEF_AOP,
      scope: 'owner-customer',
      nextRunHint: 'every Monday at 7am',
    });
    expect(text).toMatch(/your skill/);
    expect(text).toMatch(/Done\./);
    expect(text).toMatch(/every Monday at 7am/);
  });

  it('internal-admin scope says "the platform skill"', () => {
    const text = buildChatConfirmation({
      ast: WEEKLY_BRIEF_AOP,
      scope: 'internal-admin',
      nextRunHint: null,
    });
    expect(text).toMatch(/platform skill/);
  });

  it('mentions pause/show for cron triggers', () => {
    const text = buildChatConfirmation({
      ast: WEEKLY_BRIEF_AOP,
      scope: 'owner-customer',
      nextRunHint: null,
    });
    expect(text).toMatch(/pause/);
    expect(text).toMatch(/show/);
  });

  it('mentions disarm for event triggers', () => {
    const text = buildChatConfirmation({
      ast: LEASE_RENEWAL_AOP,
      scope: 'owner-customer',
      nextRunHint: null,
    });
    expect(text).toMatch(/disarm/);
  });
});

describe('buildChatRejection', () => {
  it('intent-rejected → friendly rephrase advice', () => {
    const text = buildChatRejection({
      stage: 'intent-rejected',
      errors: [],
    });
    expect(text).toMatch(/recurring or conditional/);
  });

  it('autonomy-rejected → mentions the cap', () => {
    const text = buildChatRejection({
      stage: 'autonomy-rejected',
      errors: [
        { code: 'autonomy-cap-exceeded', message: 'over daily cap' },
      ],
    });
    expect(text).toMatch(/cap/);
  });

  it('aop-parse-failed → suggests simpler phrasing', () => {
    const text = buildChatRejection({
      stage: 'aop-parse-failed',
      errors: [{ code: 'invalid-json', message: 'bad JSON' }],
    });
    expect(text).toMatch(/simpler phrasing/);
  });

  it('aop-validation-failed → mentions structural problem', () => {
    const text = buildChatRejection({
      stage: 'aop-validation-failed',
      errors: [{ code: 'orphan-ref', message: 'orphan reference' }],
    });
    expect(text).toMatch(/structural/);
  });

  it('destructive-blocked → mentions approval step', () => {
    const text = buildChatRejection({
      stage: 'destructive-blocked',
      errors: [
        { code: 'tenant-authority-unguarded', message: 'eviction without ask-owner' },
      ],
    });
    expect(text).toMatch(/approval/);
  });
});
