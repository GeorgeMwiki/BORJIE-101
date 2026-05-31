'use client';

/**
 * SignupKindStep — Step 1 of the owner self-signup wizard.
 *
 * Two large card pickers presented in the LitFin two-up grid pattern:
 *   - INDIVIDUAL ("Mimi ni mtu binafsi (mchimbaji wa kawaida)")
 *   - BUSINESS   ("Mimi nina kampuni / shirika")
 *
 * Hairline border, signal-gold focus ring + hover glow, mono-caption
 * "Endelea ›" affordance at the bottom that matches the wider Borjie
 * surface vocabulary.
 */

import { ArrowRight } from 'lucide-react';
import { useT } from '@/i18n/t.client';
import type { AccountKind } from './SignupWizard';

interface SignupKindStepProps {
  readonly onPick: (kind: AccountKind) => void;
}

interface KindCard {
  readonly kind: AccountKind;
  readonly titleKey: string;
  readonly subtitleKey: string;
  readonly bulletKeys: ReadonlyArray<string>;
}

const CARDS: ReadonlyArray<KindCard> = [
  {
    kind: 'individual',
    titleKey: 'signup.kind.individualTitle',
    subtitleKey: 'signup.kind.individualSubtitle',
    bulletKeys: [
      'signup.kind.individualBullet1',
      'signup.kind.individualBullet2',
      'signup.kind.individualBullet3',
      'signup.kind.individualBullet4',
    ],
  },
  {
    kind: 'business',
    titleKey: 'signup.kind.businessTitle',
    subtitleKey: 'signup.kind.businessSubtitle',
    bulletKeys: [
      'signup.kind.businessBullet1',
      'signup.kind.businessBullet2',
      'signup.kind.businessBullet3',
      'signup.kind.businessBullet4',
    ],
  },
] as const;

export function SignupKindStep({ onPick }: SignupKindStepProps): JSX.Element {
  const t = useT();
  return (
    <div data-testid="signup-kind-step" className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
          {t('signup.kind.question')}
        </h2>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <button
            key={card.kind}
            type="button"
            data-testid={`signup-kind-card-${card.kind}`}
            onClick={() => onPick(card.kind)}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface-raised p-6 text-left transition-all duration-base ease-out hover:border-signal-500/50 hover:shadow-signal-glow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            <div>
              <h3 className="font-display text-lg font-medium tracking-tight text-foreground group-hover:text-signal-500">
                {t(card.titleKey)}
              </h3>
            </div>
            <p className="text-sm leading-relaxed text-neutral-300">
              {t(card.subtitleKey)}
            </p>
            <ul className="space-y-1.5 text-xs text-neutral-400">
              {card.bulletKeys.map((bulletKey) => (
                <li key={bulletKey} className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-signal-500">
                    •
                  </span>
                  <span>{t(bulletKey)}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto inline-flex items-center gap-1 font-mono text-caption uppercase tracking-widest text-signal-500">
              {t('signup.nav.continue')}
              <ArrowRight className="h-3 w-3 transition-transform duration-fast group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
