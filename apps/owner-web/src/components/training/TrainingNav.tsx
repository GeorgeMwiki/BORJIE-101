'use client';

/**
 * <TrainingNav> — segmented sub-navigation across the two owner-cockpit
 * training surfaces: scenario simulation (/training/scenarios) and the mastery
 * checkpoint (/training/checkpoint).
 *
 * Matches the owner-web dark-theme pill rhythm (rounded-full, signal-500
 * active, surface hover) so the look stays native to the cockpit. All copy is
 * resolved through `trainingT` — zero Swahili literals in this file.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GraduationCap, Award } from 'lucide-react';
import type { ScenarioLanguage } from '@borjie/api-client/training-types';
import { trainingT } from '@/i18n/strings/training';

interface TrainingNavProps {
  readonly locale: ScenarioLanguage;
}

const ITEMS = [
  { href: '/training/scenarios', icon: GraduationCap, key: 'navScenarios' as const },
  { href: '/training/checkpoint', icon: Award, key: 'navCheckpoint' as const },
];

export function TrainingNav({ locale }: TrainingNavProps) {
  const tr = trainingT(locale);
  const pathname = usePathname();

  return (
    <nav
      aria-label={tr.t('navLabel')}
      className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface/40 p-1"
    >
      {ITEMS.map((item) => {
        const isActive = pathname?.startsWith(item.href) ?? false;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
              isActive
                ? 'bg-signal-500 text-background'
                : 'text-neutral-400 hover:bg-surface hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {tr.t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
