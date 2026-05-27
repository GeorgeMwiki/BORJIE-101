'use client';

import type { BuyerAccountKind } from './types';
import { getMessages, type Locale } from '@/lib/i18n';

interface BuyerKindStepProps {
  readonly locale: Locale;
  readonly onPick: (kind: BuyerAccountKind) => void;
}

/**
 * Step 1 of the buyer signup wizard.
 *
 * Pure presentational: two large card pickers — INDIVIDUAL vs BUSINESS.
 * Each card lists the fields the user will need in step 2 so they
 * can pick the lighter path knowingly. Mirrors the owner-web
 * `SignupKindStep` UX but uses the marketing-site design tokens
 * (signal-500 accent, font-display headings, OKLCH border).
 */
export function BuyerKindStep({ locale, onPick }: BuyerKindStepProps) {
  const t = getMessages(locale).buyerSignupPage.kindStep;

  const cards: ReadonlyArray<{
    readonly kind: BuyerAccountKind;
    readonly title: string;
    readonly titleAlt: string;
    readonly subtitle: string;
    readonly bullets: ReadonlyArray<string>;
  }> = [
    {
      kind: 'individual',
      title: t.individualTitle,
      titleAlt: t.individualTitleEn,
      subtitle: t.individualSubtitle,
      bullets: t.individualBullets,
    },
    {
      kind: 'business',
      title: t.businessTitle,
      titleAlt: t.businessTitleEn,
      subtitle: t.businessSubtitle,
      bullets: t.businessBullets,
    },
  ];

  return (
    <div data-testid="buyer-kind-step" className="space-y-5">
      <header>
        <h2 className="font-display text-xl font-semibold text-foreground">
          {t.heading}
        </h2>
        <p className="mt-1 text-xs text-foreground/60">{t.subHeading}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.kind}
            type="button"
            data-testid={`buyer-kind-card-${card.kind}`}
            onClick={() => onPick(card.kind)}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-surface/40 p-5 text-left transition-colors duration-base ease-out hover:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            <div>
              <h3 className="font-display text-base font-medium text-foreground group-hover:text-accent">
                {card.title}
              </h3>
              <p className="text-xs text-foreground/60">{card.titleAlt}</p>
            </div>
            <p className="text-sm text-foreground/80">{card.subtitle}</p>
            <ul className="space-y-1 text-xs text-foreground/70">
              {card.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-signal-500">
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto font-mono text-meta uppercase tracking-widest text-signal-500">
              {t.continue} ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
