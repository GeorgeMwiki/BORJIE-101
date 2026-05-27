/**
 * BorjieSegmentHeader — divider between conversation phases.
 *
 * When more than 5 minutes pass between two assistant turns (or on
 * first render with rehydrated history), the panel inserts one of these
 * dividers ("Just now" / "Earlier today" / "Yesterday") so the user can
 * see the conversational seams at a glance.
 *
 * Mirrors LitFin's `SegmentHeader` pattern: a centered pill with a
 * hairline rule on either side, 10px muted text. No portal-icon set
 * (Borjie is single-portal in the marketing widget) — just the label.
 *
 * No external icon dependency; we lean on the same bilingual relative-
 * time copy that `BorjieChatBubble` uses below each bubble.
 */
import { MESSAGES, t } from './messages';
import type { BorjieLanguage } from './useBorjieChat';

interface BorjieSegmentHeaderProps {
  /** Label key resolved by `segmentLabel()` below. Plain strings are
   *  rendered as-is so callers can pass exotic copy (e.g. an OG date)
   *  without round-tripping through the dictionary. */
  readonly label: string;
  readonly language: BorjieLanguage;
}

export function BorjieSegmentHeader({
  label,
  language: _language,
}: BorjieSegmentHeaderProps): JSX.Element {
  return (
    <li
      data-testid="borjie-segment-header"
      role="separator"
      aria-label={label}
      style={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 0',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          height: 1,
          background: 'rgba(11, 15, 25, 0.10)',
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: 'rgba(11, 15, 25, 0.55)',
          letterSpacing: '0.04em',
          textTransform: 'none',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          height: 1,
          background: 'rgba(11, 15, 25, 0.10)',
        }}
      />
    </li>
  );
}

/** Bilingual label for a segment gap given the message timestamps it
 *  bridges. Returns null when the two messages are within 5 minutes and
 *  no divider should be drawn. The hard 5-minute threshold matches
 *  LitFin's `SegmentHeader` rule of thumb. */
export function segmentLabel(
  previousISO: string | null,
  nextISO: string,
  language: BorjieLanguage,
  nowMs: number = Date.now(),
): string | null {
  const nextMs = new Date(nextISO).getTime();
  if (Number.isNaN(nextMs)) return null;
  if (!previousISO) {
    // First message after a rehydrate. Only show a divider if it's old.
    return relativeBucketLabel(nextMs, nowMs, language);
  }
  const prevMs = new Date(previousISO).getTime();
  if (Number.isNaN(prevMs)) return null;
  const gapMs = nextMs - prevMs;
  if (gapMs < 5 * 60 * 1000) return null;
  return relativeBucketLabel(nextMs, nowMs, language);
}

function relativeBucketLabel(
  thenMs: number,
  nowMs: number,
  language: BorjieLanguage,
): string | null {
  const diffMs = Math.max(0, nowMs - thenMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5 * 60) {
    // Within the segment threshold — caller already filtered, but be
    // defensive.
    return t(MESSAGES.relativeJustNow, language);
  }
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) {
    return t(MESSAGES.relativeEarlierToday, language);
  }
  if (hours < 24) {
    return t(MESSAGES.relativeEarlierToday, language);
  }
  if (hours < 48) {
    return t(MESSAGES.relativeYesterday, language);
  }
  return t(MESSAGES.relativeEarlierToday, language);
}
