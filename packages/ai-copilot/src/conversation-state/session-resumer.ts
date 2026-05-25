/**
 * Session resumer
 *
 * When a user returns to an existing conversation (or starts fresh after
 * some hours), this module produces the "seamless resume" line. Uses last
 * session snapshot signals to decide:
 *
 *   < 6 h      \u2192 soft continue (`let us continue`)
 *   < 24 h     \u2192 warm resume  (`last time you were reviewing \u2026`)
 *   >= 24 h    \u2192 full greeting (delegate to greeting-generator)
 */

import { generateGreeting } from './greeting-generator.js';
import type { UserHistorySignals } from './types.js';

export interface ResumeDecision {
  readonly mode: 'soft_continue' | 'warm_resume' | 'full_greeting';
  readonly message: string;
}

export interface ResumeInput {
  readonly language: 'en' | 'sw';
  readonly now: Date;
  readonly user: UserHistorySignals;
  readonly openInsightCount?: number;
}

export function resumeDecision(input: ResumeInput): ResumeDecision {
  const hours = hoursSinceLast(input.user.lastSessionAt, input.now);
  if (hours === null || hours >= 24) {
    return {
      mode: 'full_greeting',
      message: generateGreeting(input),
    };
  }
  if (hours < 6) {
    return {
      mode: 'soft_continue',
      message:
        input.language === 'sw'
          ? 'Karibu tena \u2014 tuendelee.'
          : 'Welcome back \u2014 let us continue.',
    };
  }
  return {
    mode: 'warm_resume',
    message:
      input.language === 'sw'
        ? `Karibu tena. Mara ya mwisho tulikuwa ${input.user.lastFocus ?? 'tukiangalia portfolio yako'}.`
        : `Welcome back. Last time we were ${input.user.lastFocus ?? 'reviewing your portfolio'}.`,
  };
}

function hoursSinceLast(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  return Math.max(0, (now.getTime() - then) / (60 * 60 * 1000));
}
