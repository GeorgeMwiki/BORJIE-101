'use client';

/**
 * SignupKindStep — Step 1 of the owner self-signup wizard.
 *
 * Pure presentational component. Renders two large card pickers:
 *   - INDIVIDUAL ("Mimi ni mtu binafsi (mchimbaji wa kawaida)")
 *   - BUSINESS   ("Mimi nina kampuni / shirika")
 *
 * Each card lists the information that will be needed in step 2 so
 * the user can pick the lighter path knowingly.
 */

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
    <div data-testid="signup-kind-step" className="space-y-5">
      <header>
        <h2 className="text-lg font-medium text-foreground">
          Unataka kujisajili kama nani?
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          How would you like to sign up?
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => (
          <button
            key={card.kind}
            type="button"
            data-testid={`signup-kind-card-${card.kind}`}
            onClick={() => onPick(card.kind)}
            className="group flex flex-col items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-left hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <div>
              <h3 className="text-base font-medium text-foreground group-hover:text-amber-400">
                {card.titleSw}
              </h3>
              <p className="text-xs text-neutral-500">{card.titleEn}</p>
            </div>
            <p className="text-sm text-neutral-300">{card.subtitleSw}</p>
            <ul className="space-y-1 text-xs text-neutral-400">
              {card.bulletsSw.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-amber-500">
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto text-xs font-medium uppercase tracking-wider text-amber-500">
              Endelea ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
