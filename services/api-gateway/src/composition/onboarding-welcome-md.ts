/**
 * Phase F.5 — welcome.coordinator (one-off onboarding sub-MD).
 *
 * Intentionally NOT in `packages/central-intelligence/src/kernel/sub-mds/`
 * because this sub-MD only fires once per tenant and is tightly coupled
 * to signup paths. Lives in api-gateway composition so it can evolve
 * with the signup UX without touching the central-intelligence kernel.
 *
 * What it does:
 *   1. Greets the owner by name + business
 *   2. Surfaces 3 intent questions (cashflow-first / growth / exit-prep)
 *   3. Suggests 3 Skills from the marketplace based on the intent the
 *      owner indicates in their initial prompt (heuristic; the real
 *      LLM-backed flow lands once the kernel hook is wired by F3)
 *   4. Offers to schedule the first daily briefing
 *
 * Deterministic + dependency-free so the onboarding flow can run on the
 * test docker-compose stack with a mock-LLM. When the real kernel route
 * lands (F3 territory) this file flips to calling the kernel — for now
 * it returns hand-rolled copy that matches the eventual contract.
 */

export interface SuggestedSkill {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly rationale: string;
}

export interface IntentQuestion {
  readonly id: 'cashflow' | 'growth' | 'exit';
  readonly label: string;
  readonly hint: string;
}

export interface WelcomeCoordinatorInput {
  readonly ownerEmail: string;
  readonly businessName: string;
  readonly country: string;
  readonly ownerPrompt?: string;
  readonly previousIntent?: 'cashflow' | 'growth' | 'exit';
}

export interface WelcomeCoordinatorResult {
  readonly messageId: string;
  readonly greeting: string;
  readonly intentQuestions: ReadonlyArray<IntentQuestion>;
  readonly inferredIntent: 'cashflow' | 'growth' | 'exit' | null;
  readonly suggestedSkills: ReadonlyArray<SuggestedSkill>;
  readonly offerDailyBriefing: {
    readonly text: string;
    readonly defaultTime: string;
    readonly defaultChannel: 'whatsapp' | 'email' | 'app';
  };
}

const INTENT_QUESTIONS: ReadonlyArray<IntentQuestion> = Object.freeze([
  {
    id: 'cashflow',
    label: 'Cashflow-first — collect rent reliably and keep arrears low.',
    hint: 'Best if rent collection + arrears are your top pain.',
  },
  {
    id: 'growth',
    label: 'Growth — add more units, optimise rents, scale the portfolio.',
    hint: 'Best if you plan to acquire more properties in the next 12 months.',
  },
  {
    id: 'exit',
    label: 'Exit-prep — clean books and credible NOI for sale or refinance.',
    hint: 'Best if you are within 12-24 months of a sale or refinance.',
  },
]);

const SKILL_PACKS: Readonly<
  Record<'cashflow' | 'growth' | 'exit', ReadonlyArray<SuggestedSkill>>
> = Object.freeze({
  cashflow: [
    {
      slug: 'arrears-friday-digest',
      name: 'Arrears Friday digest',
      description:
        'Every Friday 08:30 EAT, email the top 10 arrears tenants with case state and proposed next step.',
      rationale:
        'Fastest path to lower arrears — most owners see DSO drop 7-12 days within 60 days.',
    },
    {
      slug: 'monthly-arrears-chase',
      name: 'Monthly arrears chase ladder',
      description:
        'Day 3 / Day 7 / Day 15 / Day 30 escalation ladder, owner-approved at each rung.',
      rationale:
        'Polite-but-firm cadence proven to recover 85% of arrears by day 30.',
    },
    {
      slug: 'm-pesa-reconciliation',
      name: 'M-Pesa daily reconciliation',
      description:
        'Match incoming M-Pesa STK callbacks to tenant accounts, flag mismatches by 09:00 EAT.',
      rationale:
        'Stops the #1 collection leak: payments arriving but not posted to the right lease.',
    },
  ],
  growth: [
    {
      slug: 'vacancy-aging-watch',
      name: 'Vacancy aging watch',
      description:
        'Alert when any unit hits 14 / 30 / 60 days vacant with a price-elasticity suggestion.',
      rationale:
        'Vacancy is your biggest growth tax. Owners cutting vacancy 5 → 3% gain ~14% NOI.',
    },
    {
      slug: 'lease-renewal-90d',
      name: 'Lease renewal early-warning',
      description:
        'Trigger 90 days before each lease end with a market-rate comparison and a draft offer.',
      rationale:
        'Pre-empting churn is 4× cheaper than re-letting. Most owners under-raise on renewal.',
    },
    {
      slug: 'unit-uplift-finder',
      name: 'Unit uplift finder',
      description:
        'Monthly scan: which units are >10% under market and what minor reno would justify a raise.',
      rationale:
        'Single best lever for organic growth without acquiring new properties.',
    },
  ],
  exit: [
    {
      slug: 'kra-monthly-filing',
      name: 'KRA monthly filing compiler',
      description:
        'On the 1st of each month, compile prior-month MRI receipts, validate against rent roll, produce a draft filing.',
      rationale:
        'Clean tax record is non-negotiable for buyers and lenders.',
    },
    {
      slug: 'monthly-noi-pack',
      name: 'Monthly NOI investor pack',
      description:
        'PDF + spreadsheet on the 5th of each month with rent roll, OPEX, NOI, and YoY comparison.',
      rationale:
        'Buyers ask for trailing-12-months NOI. Having it pre-baked accelerates due diligence.',
    },
    {
      slug: 'capex-log',
      name: 'CapEx + improvements log',
      description:
        'Auto-track every CapEx work-order with photos + receipts for cost-base proof at sale.',
      rationale:
        'Substantiates depreciation and cost-base in the sale prospectus.',
    },
  ],
});

const KEYWORD_TO_INTENT: ReadonlyArray<{
  readonly intent: 'cashflow' | 'growth' | 'exit';
  readonly keywords: ReadonlyArray<RegExp>;
}> = [
  {
    intent: 'cashflow',
    keywords: [
      /arrears/i,
      /rent collection/i,
      /cashflow/i,
      /late paying/i,
      /m-?pesa/i,
      /defaulter/i,
    ],
  },
  {
    intent: 'growth',
    keywords: [
      /grow/i,
      /scale/i,
      /acquire/i,
      /more units/i,
      /vacancy/i,
      /occupancy/i,
      /raise rent/i,
    ],
  },
  {
    intent: 'exit',
    keywords: [
      /sell/i,
      /exit/i,
      /refinance/i,
      /investor/i,
      /due diligence/i,
      /noi/i,
      /tax/i,
      /kra/i,
    ],
  },
];

function inferIntent(prompt: string | undefined): 'cashflow' | 'growth' | 'exit' | null {
  if (!prompt) return null;
  for (const { intent, keywords } of KEYWORD_TO_INTENT) {
    if (keywords.some((rx) => rx.test(prompt))) return intent;
  }
  return null;
}

function buildGreeting(input: WelcomeCoordinatorInput): string {
  const businessLabel = input.businessName || 'your portfolio';
  return [
    `Hi, I'm Mr. Mwikila — the MD for ${businessLabel}.`,
    `I'll keep your operations tight, your rent on time, and your books audit-ready.`,
    `To pick the right starter Skills, tell me which of the three best fits where you are today:`,
  ].join(' ');
}

import { randomUUID } from 'crypto';

const MESSAGE_ID_PREFIX = 'msg_welcome_';

function newMessageId(): string {
  // CRITICAL #2 / quick-win Q1 — message IDs were guessable via
  // Math.random(). Replace with crypto.randomUUID() (122 bits entropy).
  return `${MESSAGE_ID_PREFIX}${randomUUID()}`;
}

/**
 * Run the welcome coordinator. Pure function (no IO) so it stays
 * deterministic in tests.
 */
export async function runWelcomeCoordinator(
  input: WelcomeCoordinatorInput,
): Promise<WelcomeCoordinatorResult> {
  const inferredIntent =
    input.previousIntent ?? inferIntent(input.ownerPrompt) ?? null;

  const skillPackKey: 'cashflow' | 'growth' | 'exit' =
    inferredIntent ?? 'cashflow'; // default to cashflow if we can't infer

  return {
    messageId: newMessageId(),
    greeting: buildGreeting(input),
    intentQuestions: INTENT_QUESTIONS,
    inferredIntent,
    suggestedSkills: SKILL_PACKS[skillPackKey],
    offerDailyBriefing: {
      text:
        'Would you like a 5-minute daily briefing every morning at 07:00 EAT? I can send it to WhatsApp, email, or the app.',
      defaultTime: '07:00',
      defaultChannel: 'whatsapp',
    },
  };
}
