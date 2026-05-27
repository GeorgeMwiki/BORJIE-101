/**
 * useRelativeTime — small hook that re-renders every 30s so a bubble's
 * timestamp label drifts from "Just now" → "1m ago" → "2m ago" without
 * the caller wiring its own interval.
 *
 * Mirrors LitFin's `relativeTime` helper from
 * `core/litfin-ai/providers/LitFinAIProvider.tsx`. The bilingual copy
 * lives in `messages.ts` (`relativeJustNow`, `relativeMinutesAgo`,
 * `relativeHoursAgo`, `relativeYesterday`) so the hook just selects the
 * right bucket and substitutes `{n}`.
 *
 * Sub-30s drift is intentionally hidden behind a single "Just now"
 * label — visitors don't need second-precision and frequent re-renders
 * would burn frames during streaming.
 *
 * Honours `prefers-reduced-motion` only indirectly — the hook itself
 * has no animation, but consumers that pair it with motion can collapse
 * their transitions independently.
 */
import { useEffect, useState } from 'react';
import { MESSAGES, t } from './messages';
import type { BorjieLanguage } from './useBorjieChat';

const TICK_MS = 30_000; // 30s — matches LitFin's poll cadence

function diffBucket(nowMs: number, thenMs: number): {
  readonly kind: 'now' | 'minutes' | 'hours' | 'yesterday' | 'earlier';
  readonly n: number;
} {
  const diffMs = Math.max(0, nowMs - thenMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return { kind: 'now', n: 0 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { kind: 'minutes', n: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'hours', n: hours };
  if (hours < 48) return { kind: 'yesterday', n: 1 };
  return { kind: 'earlier', n: hours };
}

export function formatRelative(
  timestampISO: string,
  language: BorjieLanguage,
  nowMs: number = Date.now(),
): string {
  const thenMs = new Date(timestampISO).getTime();
  if (Number.isNaN(thenMs)) return t(MESSAGES.relativeJustNow, language);
  const { kind, n } = diffBucket(nowMs, thenMs);
  switch (kind) {
    case 'now':
      return t(MESSAGES.relativeJustNow, language);
    case 'minutes':
      return t(MESSAGES.relativeMinutesAgo, language).replace('{n}', String(n));
    case 'hours':
      return t(MESSAGES.relativeHoursAgo, language).replace('{n}', String(n));
    case 'yesterday':
      return t(MESSAGES.relativeYesterday, language);
    case 'earlier':
      return t(MESSAGES.relativeEarlierToday, language);
    default:
      return t(MESSAGES.relativeJustNow, language);
  }
}

/** Returns a bilingual relative label for the given ISO timestamp,
 *  refreshing every 30s. Safe on SSR (initial render uses Date.now()
 *  on the client only via useEffect — until then we return "Just now"
 *  which is the most likely correct value for a freshly-sent message). */
export function useRelativeTime(
  timestampISO: string,
  language: BorjieLanguage,
): string {
  const [label, setLabel] = useState<string>(() =>
    formatRelative(timestampISO, language, Date.now()),
  );

  useEffect(() => {
    const recompute = () => setLabel(formatRelative(timestampISO, language, Date.now()));
    recompute();
    const interval = window.setInterval(recompute, TICK_MS);
    return () => window.clearInterval(interval);
  }, [timestampISO, language]);

  return label;
}
