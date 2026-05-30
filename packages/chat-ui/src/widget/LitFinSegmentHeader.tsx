'use client';

/**
 * Segment Header — carbon copy of LitFin's SegmentHeader, Borjie-skinned.
 *
 * Renders a portal segment divider between groups of messages.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/SegmentHeader.tsx
 */

import type { JSX } from 'react';

type SegmentPortalId =
  | 'public'
  | 'owner'
  | 'estate-manager'
  | 'admin'
  | 'customer';

const PORTAL_COLORS: Record<
  SegmentPortalId,
  { readonly bg: string; readonly text: string; readonly icon: string }
> = {
  public: { bg: 'bg-muted', text: 'text-muted-foreground', icon: '\u{1F310}' },
  owner: {
    bg: 'bg-primary/10',
    text: 'text-primary dark:text-primary',
    icon: '\u{1F3E0}',
  },
  'estate-manager': {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    icon: '\u{1F4CB}',
  },
  customer: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    icon: '\u{1F464}',
  },
  admin: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    icon: '\u{2699}\u{FE0F}',
  },
};

const PORTAL_LABELS: Record<
  SegmentPortalId,
  { readonly en: string; readonly sw: string }
> = {
  public: { en: 'Public', sw: 'Umma' },
  owner: { en: 'Owner', sw: 'Mmiliki' },
  'estate-manager': { en: 'Estate Manager', sw: 'Meneja wa Mali' },
  admin: { en: 'Admin', sw: 'Msimamizi' },
  customer: { en: 'Tenant', sw: 'Mpangaji' },
};

export interface LitFinSegmentHeaderProps {
  readonly portalId: SegmentPortalId | string;
  readonly label?: string;
  readonly startedAt: string;
  readonly messageCount: number;
  readonly language?: 'en' | 'sw';
}

export function LitFinSegmentHeader({
  portalId,
  label,
  startedAt,
  messageCount,
  language = 'en',
}: LitFinSegmentHeaderProps): JSX.Element {
  const colors =
    (PORTAL_COLORS as Record<string, (typeof PORTAL_COLORS)[SegmentPortalId]>)[
      portalId
    ] ?? PORTAL_COLORS.public;
  const labelMap =
    (PORTAL_LABELS as Record<string, (typeof PORTAL_LABELS)[SegmentPortalId]>)[
      portalId
    ] ?? PORTAL_LABELS.public;
  const displayLabel = label || labelMap[language];
  const msgWord =
    messageCount === 1
      ? language === 'sw'
        ? 'ujumbe'
        : 'msg'
      : language === 'sw'
        ? 'ujumbe'
        : 'msgs';
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="h-px flex-1 bg-border" />
      <div
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${colors.bg} ${colors.text}`}
      >
        <span>{colors.icon}</span>
        <span>{displayLabel}</span>
        <span className="opacity-50">·</span>
        <span className="opacity-70">{formatSegmentDate(startedAt)}</span>
        {messageCount > 0 && (
          <>
            <span className="opacity-50">·</span>
            <span className="opacity-70">{messageCount} {msgWord}</span>
          </>
        )}
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function formatSegmentDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (diffDays === 0) return timeStr;
    if (diffDays === 1) return `Yesterday ${timeStr}`;
    if (diffDays < 7) {
      const dayName = date.toLocaleDateString([], { weekday: 'short' });
      return `${dayName} ${timeStr}`;
    }
    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ` ${timeStr}`
    );
  } catch {
    return '';
  }
}
