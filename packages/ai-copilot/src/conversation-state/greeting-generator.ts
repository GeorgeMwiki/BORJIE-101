/**
 * Greeting generator.
 *
 * Produces a time-of-day + user-history-aware greeting for Mr. Mwikila.
 * Zero LLM. The goal is *reliable*, consistent voice. The LLM can rewrite
 * these greetings for flavour, but it should never fail to produce one.
 */

import type { UserHistorySignals } from './types.js';

export interface GreetingInput {
  readonly language: 'en' | 'sw';
  readonly now: Date;
  readonly user: UserHistorySignals;
  readonly openInsightCount?: number;
}

export function generateGreeting(input: GreetingInput): string {
  const tod = timeOfDay(input.now, input.language);
  const name = input.user.displayName;
  const resume = buildResumeLine(input);
  const insights = buildInsightLine(input);

  if (input.language === 'sw') {
    return [
      `${tod}, ${name}. Hapa ni Mr. Mwikila.`,
      resume,
      insights,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [`${tod}, ${name}. Mr. Mwikila here.`, resume, insights]
    .filter(Boolean)
    .join(' ');
}

function timeOfDay(now: Date, lang: 'en' | 'sw'): string {
  const hour = now.getHours();
  if (lang === 'sw') {
    if (hour < 12) return 'Habari za asubuhi';
    if (hour < 17) return 'Habari za mchana';
    return 'Habari za jioni';
  }
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function buildResumeLine(input: GreetingInput): string {
  const { user, language } = input;
  if (!user.lastSessionAt) {
    return language === 'sw'
      ? 'Karibu kwenye estate yako. Tuanze kusukuma mgodi.'
      : "Welcome to your estate. Let's get the mine moving.";
  }
  const hours = hoursSince(user.lastSessionAt, input.now);
  if (hours < 6) {
    return language === 'sw' ? 'Tuendelee tulipoishia.' : 'Let us pick up where we left off.';
  }
  if (user.lastFocus) {
    return language === 'sw'
      ? `Mara ya mwisho ulikuwa ukiangalia ${user.lastFocus}; tuendelee?`
      : `Last time you were reviewing ${user.lastFocus}. Should we continue?`;
  }
  return language === 'sw' ? 'Karibu tena.' : 'Welcome back.';
}

function buildInsightLine(input: GreetingInput): string {
  const count = input.openInsightCount ?? 0;
  if (count === 0) return '';
  if (input.language === 'sw') {
    return `Nimekuandalia ${count} uchambuzi mpya. Utaanza na upi?`;
  }
  return `I have ${count} fresh insight${count === 1 ? '' : 's'} for you. Where do you want to start?`;
}

function hoursSince(isoTs: string, now: Date): number {
  const then = new Date(isoTs).getTime();
  return Math.max(0, (now.getTime() - then) / (60 * 60 * 1000));
}
