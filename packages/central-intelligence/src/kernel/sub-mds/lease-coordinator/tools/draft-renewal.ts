/**
 * `lease.draft_renewal` — DRAFT-only.
 *
 * Produces a draft renewal offer for the owner to review. Uses the
 * forecasting-engine retention curve (injected via the
 * `RetentionForecastPort`) to project P(retain) at the proposed rent.
 *
 * Production wires the forecasting-engine adapter; tests inject a
 * deterministic curve.
 */

export interface MarketComp {
  readonly p50Minor: number;
  readonly p75Minor: number;
  readonly currency: string;
}

export interface RetentionForecastPort {
  /** Given a candidate rent, return P(retain) in [0,1]. */
  forecast(args: {
    readonly tenantId: string;
    readonly currentRentMinor: number;
    readonly proposedRentMinor: number;
  }): Promise<{ readonly pRetain: number; readonly basis: string }>;
}

export interface DraftRenewalArgs {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly leaseId: string;
  readonly currentRentMinor: number;
  readonly currency: string;
  readonly market: MarketComp;
  readonly forecast: RetentionForecastPort;
  /** The owner's max acceptable increase. Defaults to 5%. */
  readonly maxIncreasePct?: number;
  readonly termMonths?: number;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly ownerSignature: string;
}

export interface DraftedRenewal {
  readonly proposedRentMinor: number;
  readonly increasePct: number;
  readonly termMonths: number;
  readonly pRetain: number;
  readonly retentionBasis: string;
  readonly subject: string;
  readonly body: string;
  readonly draftStatus: 'queued-for-owner-review';
  readonly retentionVerdict: 'strong' | 'fair' | 'weak';
}

const DEFAULT_MAX_INCREASE_PCT = 0.05;
const DEFAULT_TERM_MONTHS = 12;

export async function draftRenewal(args: DraftRenewalArgs): Promise<DraftedRenewal> {
  const maxIncrease = args.maxIncreasePct ?? DEFAULT_MAX_INCREASE_PCT;
  const termMonths = args.termMonths ?? DEFAULT_TERM_MONTHS;
  // Anchor the proposal near market p50, capped by maxIncrease.
  const marketAnchor = args.market.p50Minor;
  const cappedRent = Math.min(
    marketAnchor,
    Math.round(args.currentRentMinor * (1 + maxIncrease)),
  );
  const proposedRent = Math.max(args.currentRentMinor, cappedRent);
  const increasePct = (proposedRent - args.currentRentMinor) / args.currentRentMinor;

  const fc = await args.forecast.forecast({
    tenantId: args.tenantId,
    currentRentMinor: args.currentRentMinor,
    proposedRentMinor: proposedRent,
  });

  const retentionVerdict: DraftedRenewal['retentionVerdict'] =
    fc.pRetain >= 0.75 ? 'strong' : fc.pRetain >= 0.5 ? 'fair' : 'weak';

  const subject = renderSubject(args.language);
  const body = renderBody({
    tenantName: args.tenantName,
    leaseId: args.leaseId,
    proposedRent,
    currency: args.currency,
    termMonths,
    increasePct,
    ownerSignature: args.ownerSignature,
    lang: args.language,
  });

  return Object.freeze({
    proposedRentMinor: proposedRent,
    increasePct: Number(increasePct.toFixed(4)),
    termMonths,
    pRetain: Number(fc.pRetain.toFixed(4)),
    retentionBasis: fc.basis,
    subject,
    body,
    draftStatus: 'queued-for-owner-review',
    retentionVerdict,
  });
}

function renderSubject(lang: 'en' | 'sw' | 'mixed'): string {
  if (lang === 'sw') return 'Pendekezo la kurefusha mkataba';
  return 'Lease renewal proposal — for your review';
}

function renderBody(args: {
  readonly tenantName: string;
  readonly leaseId: string;
  readonly proposedRent: number;
  readonly currency: string;
  readonly termMonths: number;
  readonly increasePct: number;
  readonly ownerSignature: string;
  readonly lang: 'en' | 'sw' | 'mixed';
}): string {
  const major = (args.proposedRent / 100).toFixed(0);
  const incPct = (args.increasePct * 100).toFixed(1);
  const isSw = args.lang === 'sw';
  const lines: string[] = [];
  if (isSw) {
    lines.push(`Habari ${args.tenantName},`);
    lines.push('');
    lines.push(`Tunapendekeza kurefusha mkataba wako wa kodi (#${args.leaseId}) kwa miezi ${args.termMonths}.`);
    lines.push(`Kodi mpya: ${args.currency} ${major}/mwezi (ongezeko la ${incPct}%).`);
    lines.push('');
    lines.push('Hii ni rasimu kwa marejeleo ya mmiliki. Tafadhali subiri uthibitisho rasmi.');
    lines.push('');
    lines.push(`Wako,\n${args.ownerSignature}`);
  } else {
    lines.push(`Dear ${args.tenantName},`);
    lines.push('');
    lines.push(`We would like to propose renewing your lease (#${args.leaseId}) for ${args.termMonths} months.`);
    lines.push(`Proposed rent: ${args.currency} ${major}/month (${incPct}% adjustment).`);
    lines.push('');
    lines.push('This is a DRAFT pending owner review. A signed offer will follow.');
    lines.push('');
    lines.push(`Sincerely,\n${args.ownerSignature}`);
  }
  return lines.join('\n');
}
