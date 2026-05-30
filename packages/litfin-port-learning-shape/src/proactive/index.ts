/**
 * Proactive engagement / continuous-learning nudges.
 *
 * Ported from LITFIN's proactive-engagement shape (which fired
 * borrower nudges at quiet moments). For Borjie the nudges are
 * mining-domain proactive prompts Mr. Mwikila surfaces unprompted:
 *
 *   "Your gold price floor moved 4% — relook royalty filing"
 *   "Weather forecast: heavy rain tomorrow at site B. Reschedule?"
 *   "5 days since last safety drill at pit 3. Want to schedule one?"
 *   "Workforce headcount drift detected — review payroll"
 *
 * Layered alongside @borjie/proactive-intel (richer, native) and
 * @borjie/meta-learning-conductor (the continuous-learning engine).
 * This port exposes the pure-function shape so consumers can build
 * nudges from observations without depending on the richer kernel.
 */

export type NudgeUrgency = "low" | "medium" | "high" | "critical";

export type NudgeCategory =
  | "market_signal"
  | "weather"
  | "safety"
  | "payroll"
  | "regulator"
  | "operations"
  | "buyer_opportunity";

export interface Nudge {
  readonly nudgeId: string;
  readonly tenantId: string;
  readonly addresseePersonId: string;
  readonly category: NudgeCategory;
  readonly urgency: NudgeUrgency;
  readonly title: { readonly sw: string; readonly en: string };
  readonly body: { readonly sw: string; readonly en: string };
  readonly suggestedAction?: {
    readonly label: { readonly sw: string; readonly en: string };
    readonly route: string;
  };
  readonly observedAt: string;
  readonly expiresAt?: string;
}

export interface NudgeObservation {
  readonly kind:
    | "price_move"
    | "weather_alert"
    | "safety_drill_overdue"
    | "headcount_drift"
    | "filing_due"
    | "buyer_lead";
  readonly tenantId: string;
  readonly addresseePersonId: string;
  readonly observedAt: string;
  readonly meta: Record<string, string | number>;
}

const URGENCY_BY_KIND: Record<NudgeObservation["kind"], NudgeUrgency> = {
  price_move: "medium",
  weather_alert: "high",
  safety_drill_overdue: "high",
  headcount_drift: "medium",
  filing_due: "critical",
  buyer_lead: "low",
};

const CATEGORY_BY_KIND: Record<NudgeObservation["kind"], NudgeCategory> = {
  price_move: "market_signal",
  weather_alert: "weather",
  safety_drill_overdue: "safety",
  headcount_drift: "payroll",
  filing_due: "regulator",
  buyer_lead: "buyer_opportunity",
};

const TITLE_BY_KIND: Record<
  NudgeObservation["kind"],
  { readonly sw: string; readonly en: string }
> = {
  price_move: {
    sw: "Bei imebadilika — angalia mrabaha",
    en: "Price moved — relook royalty",
  },
  weather_alert: {
    sw: "Tahadhari ya hali ya hewa",
    en: "Weather alert",
  },
  safety_drill_overdue: {
    sw: "Mafunzo ya usalama yamechelewa",
    en: "Safety drill overdue",
  },
  headcount_drift: {
    sw: "Idadi ya wafanyakazi imebadilika",
    en: "Workforce headcount drift",
  },
  filing_due: {
    sw: "Tarehe ya mwisho ya uwasilishaji wa wadhibiti",
    en: "Regulator filing due",
  },
  buyer_lead: {
    sw: "Mnunuzi mpya anavutiwa",
    en: "New buyer lead",
  },
};

/**
 * Build a nudge from an observation. Pure function. Returns a NEW
 * frozen object. Caller chooses how / when / where to surface it
 * (Mr. Mwikila chat, push notification, dashboard panel).
 */
export function buildNudge(
  observation: NudgeObservation,
  nudgeId: string,
): Nudge {
  const title = TITLE_BY_KIND[observation.kind];
  const bodySw = renderBody(observation, "sw");
  const bodyEn = renderBody(observation, "en");
  return Object.freeze({
    nudgeId,
    tenantId: observation.tenantId,
    addresseePersonId: observation.addresseePersonId,
    category: CATEGORY_BY_KIND[observation.kind],
    urgency: URGENCY_BY_KIND[observation.kind],
    title,
    body: { sw: bodySw, en: bodyEn },
    observedAt: observation.observedAt,
  });
}

function renderBody(obs: NudgeObservation, lang: "sw" | "en"): string {
  switch (obs.kind) {
    case "price_move": {
      const pct = obs.meta.changePercent ?? 0;
      return lang === "sw"
        ? `Bei ya madini imeshuka/imepanda kwa ${pct}%`
        : `Mineral price moved by ${pct}%`;
    }
    case "weather_alert": {
      const desc = obs.meta.descriptionEn ?? obs.meta.descriptionSw ?? "";
      return lang === "sw"
        ? `${obs.meta.descriptionSw ?? desc}`
        : `${obs.meta.descriptionEn ?? desc}`;
    }
    case "safety_drill_overdue": {
      const days = obs.meta.daysOverdue ?? 0;
      return lang === "sw"
        ? `Hakuna mafunzo ya usalama tangu siku ${days}`
        : `No safety drill in the past ${days} days`;
    }
    case "headcount_drift": {
      const delta = obs.meta.headcountDelta ?? 0;
      return lang === "sw"
        ? `Mabadiliko ya idadi: ${delta}`
        : `Headcount change: ${delta}`;
    }
    case "filing_due": {
      const reg = obs.meta.regulator ?? "regulator";
      const dueIn = obs.meta.dueInDays ?? 0;
      return lang === "sw"
        ? `${reg}: siku ${dueIn} zilizobaki`
        : `${reg}: ${dueIn} days remaining`;
    }
    case "buyer_lead": {
      const grams = obs.meta.indicativeGrams ?? 0;
      return lang === "sw"
        ? `Mnunuzi anataka ${grams}g`
        : `Buyer wants ${grams}g`;
    }
  }
}

/**
 * Filter + sort nudges for a dashboard panel. Most urgent first;
 * expired nudges dropped.
 */
export function prioritiseNudges(args: {
  readonly nudges: ReadonlyArray<Nudge>;
  readonly now: string;
}): ReadonlyArray<Nudge> {
  const URGENCY_RANK: Record<NudgeUrgency, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const alive = args.nudges.filter(
    (n) => !n.expiresAt || n.expiresAt > args.now,
  );
  return [...alive].sort(
    (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency],
  );
}
