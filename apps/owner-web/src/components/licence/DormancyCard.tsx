'use client';

import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import { licenceCockpitStrings as S } from '@/i18n/strings/licence-cockpit';

interface DormancyCardProps {
  readonly score: number;
  readonly citation: string;
}

export function DormancyCard({ score, citation }: DormancyCardProps) {
  const locale = useLocale();
  const tone: 'green' | 'amber' | 'red' =
    score <= 30 ? 'green' : score <= 60 ? 'amber' : 'red';
  const ringColor =
    tone === 'green'
      ? 'hsl(var(--success))'
      : tone === 'amber'
        ? 'hsl(var(--warning))'
        : 'hsl(var(--destructive))';
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {pickByLocale(locale, S.dormancy.title)}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="grid h-24 w-24 place-items-center rounded-full font-display text-3xl text-foreground"
          style={{
            background: `conic-gradient(${ringColor} ${score}%, hsl(var(--border)) 0)`,
          }}
        >
          <span className="grid h-20 w-20 place-items-center rounded-full bg-surface">
            {score}
          </span>
        </div>
        <p className="flex-1 text-xs italic text-neutral-300">{citation}</p>
      </div>
    </article>
  );
}
