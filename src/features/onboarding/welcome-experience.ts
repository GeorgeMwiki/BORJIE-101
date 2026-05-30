/**
 * Welcome Experience - state + content builder.
 *
 * On first portal entry, the AI introduces itself by name + role + how
 * it can help. It already knows the user (from onboarding extraction)
 * and prepares 3 targeted "things I think will help you most" plus a
 * 90-day imagination trace.
 *
 * Mission alignment statement: "I'm here to help you build credit
 * history, not just sell you a loan."
 *
 * The content adapts per (orgType, region, sector) without LLM round-trips:
 * a small content matrix is pre-resolved at this layer; the LLM is only
 * used to soften the tone if needed (handled at render time).
 */

export interface WelcomeContext {
  readonly displayName: string;
  /** vicoba | msme | ngo | bank | borrower | unknown */
  readonly orgType: string;
  /** Tanzania regions (Arusha, Mwanza, etc) or country name. */
  readonly region?: string;
  /** Sector hint (agri, retail, services, ...). */
  readonly sector?: string;
  /** Visitor language preference. */
  readonly language: "en" | "sw";
}

export interface WelcomeAction {
  readonly id: string;
  readonly headline: string;
  readonly reason: string;
  readonly cta: string;
  readonly href: string;
}

export interface WelcomeImaginationLane {
  readonly lane: "best" | "central" | "worst";
  readonly horizon: "30-day" | "60-day" | "90-day";
  readonly description: string;
}

export interface WelcomeMessage {
  readonly greeting: string;
  readonly missionAlignment: string;
  readonly topActions: readonly WelcomeAction[];
  readonly imaginationLanes: readonly WelcomeImaginationLane[];
  readonly disclaimer: string;
}

const MISSION_ALIGNMENT_EN =
  "I am here to help you build credit history, not just sell you a loan. If a loan is not the right answer for your situation, I will tell you so.";

const MISSION_ALIGNMENT_SW =
  "Niko hapa kukusaidia kujenga rekodi ya mikopo, sio kukuuzia mkopo tu. Kama mkopo si jibu sahihi kwa hali yako, nitakuambia.";

/**
 * Deterministic top-3 action picker per (orgType, sector). Pure - no I/O.
 */
export function pickTopActions(ctx: WelcomeContext): readonly WelcomeAction[] {
  const t = ctx.orgType.toLowerCase();
  const isVicoba = t === "vicoba" || t === "vsla";
  const isBank = t === "bank";
  const isNgo = t === "ngo";
  const isMsme = t === "msme" || t === "borrower" || t === "unknown";

  if (isVicoba) {
    return VICOBA_ACTIONS;
  }
  if (isBank) {
    return BANK_ACTIONS;
  }
  if (isNgo) {
    return NGO_ACTIONS;
  }
  if (isMsme) {
    return MSME_ACTIONS;
  }
  return GENERIC_ACTIONS;
}

const VICOBA_ACTIONS: readonly WelcomeAction[] = [
  {
    id: "vicoba-meeting",
    headline: "Run your next meeting on a single device",
    reason:
      "Group meetings on one device + projector, with each member scored live.",
    cta: "Open meeting mode",
    href: "/borrower/projects",
  },
  {
    id: "readiness-board",
    headline: "See where each member stands today",
    reason: "Readiness board for the whole group, refreshed in real time.",
    cta: "Open readiness",
    href: "/borrower/readiness",
  },
  {
    id: "graduate-agents",
    headline: "Graduate your top members into trained agents",
    reason: "Trained agents earn referral fees on every successful loan.",
    cta: "Open referrals",
    href: "/borrower/referrals",
  },
];

const MSME_ACTIONS: readonly WelcomeAction[] = [
  {
    id: "readiness-score",
    headline: "Run your readiness check now",
    reason:
      "5C readiness in under 5 minutes - shows what banks will actually look at.",
    cta: "Run my readiness",
    href: "/borrower/readiness",
  },
  {
    id: "learn-credit",
    headline: "Learn the 5C framework banks use",
    reason: "12-domain learning, BKT-tracked mastery, 1-on-1 with the AI.",
    cta: "Open learning",
    href: "/borrower/learning",
  },
  {
    id: "marketplace",
    headline: "Match to lenders in your region",
    reason:
      "We only show lenders licensed in your region with rates within BoT 2026 ranges.",
    cta: "Open marketplace",
    href: "/borrower/marketplace",
  },
];

const NGO_ACTIONS: readonly WelcomeAction[] = [
  {
    id: "impact-reporting",
    headline: "Generate your next impact report",
    reason: "Auto-generated from real loan, training, and graduation data.",
    cta: "Open impact reporting",
    href: "/borrower/projects",
  },
  {
    id: "cohort-onboarding",
    headline: "Onboard a new cohort of beneficiaries",
    reason: "Bulk onboarding with the conversational flow, fully PDPA-aligned.",
    cta: "Onboard cohort",
    href: "/borrower/onboarding/conversational",
  },
  {
    id: "graduation",
    headline: "Issue graduation certificates",
    reason: "Auto-issued when readiness + curriculum thresholds are met.",
    cta: "Open graduation",
    href: "/borrower/projects",
  },
];

const BANK_ACTIONS: readonly WelcomeAction[] = [
  {
    id: "officer-dashboard",
    headline: "Open your officer dashboard",
    reason: "Live cases, leads, and decision queue.",
    cta: "Open dashboard",
    href: "/officer/dashboard",
  },
  {
    id: "model-card",
    headline: "Review the credit mind model card",
    reason:
      "Mitchell 2019 sections, fairness slices, training data hash, intended use.",
    cta: "Open model card",
    href: "/model-cards/borjie-ai-credit-mind-2.5.0-2026-05",
  },
  {
    id: "compliance",
    headline: "Confirm BoT 2026 compliance posture",
    reason: "BFIA, AMLA, PDPA, BoT Cyber Guidelines all mapped.",
    cta: "Open compliance",
    href: "/officer/dashboard",
  },
];

const GENERIC_ACTIONS: readonly WelcomeAction[] = [
  {
    id: "explore",
    headline: "Explore what Borjie can do for you",
    reason: "Pick a path - I will tailor everything from there.",
    cta: "Open dashboard",
    href: "/borrower/dashboard",
  },
  {
    id: "learn-credit",
    headline: "Learn the 5C credit framework",
    reason: "Free, in your language, paced to your level.",
    cta: "Open learning",
    href: "/borrower/learning",
  },
  {
    id: "talk-to-ai",
    headline: "Just chat with the AI officer",
    reason: "Tell me what you are trying to do; I will figure out the rest.",
    cta: "Open chat",
    href: "/borrower/dashboard",
  },
];

export function buildImaginationLanes(
  ctx: WelcomeContext,
): readonly WelcomeImaginationLane[] {
  const sectorHint = ctx.sector ?? "your business";
  return [
    {
      lane: "best",
      horizon: "30-day",
      description: `In 30 days, your ${sectorHint} has a clean readiness profile and you have shown 3 months of consistent records.`,
    },
    {
      lane: "central",
      horizon: "60-day",
      description: `In 60 days, you are running monthly self-checks, your records are tight, and you are ready to apply.`,
    },
    {
      lane: "worst",
      horizon: "90-day",
      description: `If you skip the records work, in 90 days you are still where you started. We will avoid that path together.`,
    },
  ];
}

export function buildWelcomeMessage(ctx: WelcomeContext): WelcomeMessage {
  const greeting = greetForLanguage(ctx);
  const missionAlignment =
    ctx.language === "sw" ? MISSION_ALIGNMENT_SW : MISSION_ALIGNMENT_EN;
  const disclaimer =
    ctx.language === "sw"
      ? "Maelezo haya ni ya kuongoza, sio ushauri wa kifedha au uwekezaji."
      : "These suggestions are guidance, not investment or financial advice.";

  return {
    greeting,
    missionAlignment,
    topActions: pickTopActions(ctx),
    imaginationLanes: buildImaginationLanes(ctx),
    disclaimer,
  };
}

function greetForLanguage(ctx: WelcomeContext): string {
  const sectorPhrase = ctx.sector ? ` ${ctx.sector}` : "";
  const regionPhrase = ctx.region ? ` in ${ctx.region}` : "";
  if (ctx.language === "sw") {
    return `Karibu, ${ctx.displayName}. Naona unaendesha biashara ya${sectorPhrase}${regionPhrase}. Nimekuandalia mambo matatu nadhani yatakusaidia zaidi sasa.`;
  }
  return `Welcome, ${ctx.displayName}. I see you run a${sectorPhrase} business${regionPhrase}. I have prepared 3 things I think will help you most.`;
}
