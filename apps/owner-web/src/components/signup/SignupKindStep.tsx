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
import type { AccountKind } from './SignupWizard';

interface SignupKindStepProps {
  readonly onPick: (kind: AccountKind) => void;
}

interface KindCard {
  readonly kind: AccountKind;
  readonly titleSw: string;
  readonly titleEn: string;
  readonly subtitleSw: string;
  readonly subtitleEn: string;
  readonly bulletsSw: ReadonlyArray<string>;
}

const CARDS: ReadonlyArray<KindCard> = [
  {
    kind: 'individual',
    titleSw: 'Mimi ni mtu binafsi',
    titleEn: "I'm an individual miner",
    subtitleSw: 'Mchimbaji wa kawaida au mwenye PML moja.',
    subtitleEn: 'Artisanal miner or single-PML holder.',
    bulletsSw: [
      'Jina kamili na simu',
      'Barua pepe',
      'Nambari ya leseni (PML) — si lazima',
      'Kitambulisho cha NIDA — si lazima',
    ],
  },
  {
    kind: 'business',
    titleSw: 'Mimi nina kampuni / shirika',
    titleEn: 'I have a registered company',
    subtitleSw: 'Kampuni iliyosajiliwa BRELA au PL / ML holder.',
    subtitleEn: 'BRELA-registered company or PL/ML holder.',
    bulletsSw: [
      'Jina la kampuni + nambari ya BRELA',
      'Nambari ya TIN',
      'Jina, simu, na barua pepe ya mmiliki',
      'Nambari ya leseni (PML/PL/ML) — si lazima',
    ],
  },
] as const;

export function SignupKindStep({ onPick }: SignupKindStepProps): JSX.Element {
  return (
    <div data-testid="signup-kind-step" className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
          Unataka kujisajili kama nani?
        </h2>
        <p className="mt-1 font-mono text-caption uppercase tracking-widest text-neutral-500">
          How would you like to sign up?
        </p>
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
                {card.titleSw}
              </h3>
              <p className="mt-1 font-mono text-caption uppercase tracking-widest text-neutral-500">
                {card.titleEn}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-neutral-300">
              {card.subtitleSw}
            </p>
            <ul className="space-y-1.5 text-xs text-neutral-400">
              {card.bulletsSw.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-signal-500">
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto inline-flex items-center gap-1 font-mono text-caption uppercase tracking-widest text-signal-500">
              Endelea
              <ArrowRight className="h-3 w-3 transition-transform duration-fast group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
