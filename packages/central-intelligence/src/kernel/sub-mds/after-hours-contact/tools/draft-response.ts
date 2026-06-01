/**
 * `after_hours.draft_response` — DRAFT-only.
 *
 * Generates a buyer-facing reply for the owner to review before
 * sending. Never auto-sends. Cites price bands not point prices
 * unless the owner has whitelisted a lot for direct quoting.
 */

import type { ClassifiedInquiry, InquiryIntent } from './classify-inquiry.js';
import type { MatchedLot, FetchLotMatchResult } from './fetch-lot-match.js';

export interface DraftResponseArgs {
  readonly inquiry: ClassifiedInquiry;
  readonly matches: FetchLotMatchResult;
  readonly ownerSignature: string;
  /** Hours into the morning when the owner will likely review (used
   *  to set the buyer's expectation). Defaults to 09:00. */
  readonly reviewHourLocal?: number;
}

export interface DraftedResponse {
  readonly toneTag: 'warm-honest' | 'apologetic-no-match' | 'informational';
  readonly language: 'en' | 'sw' | 'mixed';
  readonly subject: string;
  readonly body: string;
  readonly draftStatus: 'queued-for-owner-review';
  readonly suggestedNextStep: 'schedule-inspection' | 'await-availability' | 'send-pricing' | 'no-match';
}

const REVIEW_HOUR_DEFAULT = 9;

export function draftResponse(args: DraftResponseArgs): DraftedResponse {
  const { inquiry, matches } = args;
  const reviewHour = args.reviewHourLocal ?? REVIEW_HOUR_DEFAULT;
  const hasMatch = matches.matches.length > 0;
  const lang = inquiry.detectedLanguage;
  const toneTag: DraftedResponse['toneTag'] = hasMatch
    ? 'warm-honest'
    : 'apologetic-no-match';

  const subject = renderSubject(inquiry.intent, lang, hasMatch);
  const body = renderBody({
    intent: inquiry.intent,
    lang,
    matches: matches.matches,
    ...(matches.priceBand ? { priceBand: matches.priceBand } : {}),
    ownerSignature: args.ownerSignature,
    reviewHour,
    hasMatch,
  });

  const suggestedNextStep = !hasMatch
    ? 'no-match'
    : inquiry.intent === 'inspection-request'
      ? 'schedule-inspection'
      : inquiry.intent === 'pricing'
        ? 'send-pricing'
        : 'await-availability';

  return Object.freeze({
    toneTag,
    language: lang,
    subject,
    body,
    draftStatus: 'queued-for-owner-review',
    suggestedNextStep,
  });
}

function renderSubject(intent: InquiryIntent, lang: 'en' | 'sw' | 'mixed', hasMatch: boolean): string {
  if (lang === 'sw') {
    if (intent === 'inspection-request') return hasMatch ? 'Asante kwa kupendezwa — tunapanga muda' : 'Samahani — kwa sasa hatuna lot inayofaa';
    return hasMatch ? 'Asante kwa kuwasiliana' : 'Samahani kwa wakati huu';
  }
  if (intent === 'inspection-request') return hasMatch ? 'Thanks for your interest — scheduling an inspection' : 'Thanks for reaching out — no match yet';
  return hasMatch ? 'Thanks for reaching out' : 'Thanks for reaching out — no current match';
}

interface BodyArgs {
  readonly intent: InquiryIntent;
  readonly lang: 'en' | 'sw' | 'mixed';
  readonly matches: ReadonlyArray<MatchedLot>;
  readonly priceBand?: { readonly minMinor: number; readonly maxMinor: number; readonly currency: string };
  readonly ownerSignature: string;
  readonly reviewHour: number;
  readonly hasMatch: boolean;
}

function renderBody(args: BodyArgs): string {
  const isSw = args.lang === 'sw';
  const lines: string[] = [];
  if (isSw) {
    lines.push('Habari, asante kwa kuwasiliana baada ya saa za kazi.');
  } else {
    lines.push('Hello, thanks for reaching out outside office hours.');
  }
  if (args.hasMatch && args.matches.length > 0) {
    const first = args.matches[0]!;
    if (isSw) {
      lines.push(`Tuna lot inayofanana: Lot ${first.lot.lotRef}, madini ${first.lot.mineral}, kiasi cha kilo ${first.lot.quantityKg}.`);
    } else {
      lines.push(`We have a candidate lot: Lot ${first.lot.lotRef}, ${first.lot.mineral} (${first.lot.grade}), ${first.lot.quantityKg} kg.`);
    }
    if (args.priceBand) {
      const band = `${formatMinor(args.priceBand.minMinor, args.priceBand.currency)}–${formatMinor(args.priceBand.maxMinor, args.priceBand.currency)}`;
      lines.push(isSw ? `Bei iko kati ya ${band} kwa lot (tutathibitisha asubuhi).` : `Indicative price band: ${band} per lot (final quote confirmed in the morning).`);
    }
  } else {
    lines.push(isSw
      ? 'Kwa sasa hatuna lot inayolingana na mahitaji yako, lakini tutakujulisha mara itakapopatikana.'
      : 'We do not currently have a lot matching your criteria, but we will let you know as soon as one opens up.',
    );
  }
  lines.push(isSw
    ? `Mmiliki atapitia ujumbe huu kabla ya saa ${args.reviewHour}:00 asubuhi na atakujibu rasmi.`
    : `The owner will review this draft before ${formatHour(args.reviewHour)} and reply formally.`,
  );
  lines.push(isSw ? `\nKaribu sana,\n${args.ownerSignature} (Concierge)` : `\nBest regards,\n${args.ownerSignature} (Concierge)`);
  return lines.join('\n');
}

function formatMinor(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(0);
  return `${currency} ${major}`;
}

function formatHour(h: number): string {
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}
