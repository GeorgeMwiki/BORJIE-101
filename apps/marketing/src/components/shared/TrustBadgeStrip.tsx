import {
  BadgeCheck,
  Brain,
  Globe,
  Lock,
  Shield,
  type LucideIcon,
} from 'lucide-react';

/**
 * TrustBadgeStrip , LitFin-parity row of compliance / capability
 * pills. Single line on desktop, wraps to several on mobile.
 *
 * Icon names accepted are a curated mining-relevant subset
 * (Lock, Shield, Globe, Brain, BadgeCheck). Adding a new badge
 * means extending the lookup below; do not pass arbitrary lucide
 * icon names from the i18n bundle or future-typo risk creeps in.
 */
export type TrustBadgeIconName =
  | 'Lock'
  | 'Shield'
  | 'Globe'
  | 'Brain'
  | 'BadgeCheck';

export interface TrustBadgeItem {
  readonly icon: string;
  readonly text: string;
}

interface TrustBadgeStripProps {
  readonly items: readonly TrustBadgeItem[];
}

const ICONS: Record<TrustBadgeIconName, LucideIcon> = {
  Lock,
  Shield,
  Globe,
  Brain,
  BadgeCheck,
};

function resolveIcon(name: string): LucideIcon {
  return (ICONS as Record<string, LucideIcon | undefined>)[name] ?? BadgeCheck;
}

export function TrustBadgeStrip({ items }: TrustBadgeStripProps) {
  return (
    <ul className="flex flex-wrap justify-center gap-3">
      {items.map((badge) => {
        const Icon = resolveIcon(badge.icon);
        return (
          <li
            key={badge.text}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5"
          >
            <Icon className="h-3.5 w-3.5 text-signal-500" aria-hidden="true" />
            <span className="text-xs font-medium text-foreground">
              {badge.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
