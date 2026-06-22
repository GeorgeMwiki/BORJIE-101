'use client';

/**
 * <DomainPicker> — step 1 of the create-course flow.
 *
 * Renders the mining course domains (from the locale-pure COURSE_DOMAIN_OPTIONS
 * table) as a dark-theme card grid. Selecting a card hands the domain id +
 * resolved label up to the flow. owner-web house style; all copy through
 * `coursesT` (zero Swahili literals).
 */

import {
  Pickaxe,
  ShieldCheck,
  Wallet,
  HardHat,
  Handshake,
  TrendingUp,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';
import type { CourseLanguage } from '@borjie/api-client/courses-types';
import {
  coursesT,
  COURSE_DOMAIN_OPTIONS,
  type CourseDomainOption,
} from '@/i18n/strings/courses';

export interface DomainSelection {
  readonly domainId: string;
  readonly label: string;
}

interface DomainPickerProps {
  readonly locale: CourseLanguage;
  readonly onSelect: (selection: DomainSelection) => void;
}

/** Resolve a Lucide icon by the name stored on the domain option. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  Pickaxe,
  ShieldCheck,
  Wallet,
  HardHat,
  Handshake,
  TrendingUp,
};

function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? GraduationCap;
}

export function DomainPicker({ locale, onSelect }: DomainPickerProps) {
  const tr = coursesT(locale);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {tr.t('pickDomainTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr.t('pickDomainHint')}</p>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
        {COURSE_DOMAIN_OPTIONS.map((option) => (
          <li key={option.id}>
            <DomainCard locale={locale} option={option} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DomainCard({
  locale,
  option,
  onSelect,
}: {
  readonly locale: CourseLanguage;
  readonly option: CourseDomainOption;
  readonly onSelect: (selection: DomainSelection) => void;
}) {
  const tr = coursesT(locale);
  const Icon = iconFor(option.icon);
  const label = tr.domainLabel(option);

  return (
    <button
      type="button"
      onClick={() => onSelect({ domainId: option.id, label })}
      className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-signal-500/40 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-signal-500/10">
        <Icon className="h-5 w-5 text-signal-400" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {tr.domainDescription(option)}
      </span>
    </button>
  );
}
