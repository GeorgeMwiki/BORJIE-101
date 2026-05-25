/**
 * `complaint.empathize_response` — DRAFT tier.
 *
 * Drafts a tenant-facing acknowledgement tone-matched to detected
 * sentiment. ALWAYS sent to the owner for review — never auto-sent
 * to the tenant.
 */

import type {
  ComplaintCategory,
  ComplaintSentiment,
} from './classify-complaint.js';

export interface EmpathizeResponseArgs {
  readonly category: ComplaintCategory;
  readonly sentiment: ComplaintSentiment;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly tenantDisplayName?: string;
  readonly referenceId: string;
}

export interface EmpathyDraft {
  readonly body: string;
  readonly tone: 'apologetic' | 'reassuring' | 'professional' | 'thankful';
  readonly draftStatus: 'queued-for-owner-review';
  readonly autoSendable: false;
  readonly language: 'en' | 'sw' | 'mixed';
}

export function empathizeResponse(args: EmpathizeResponseArgs): EmpathyDraft {
  const tone: EmpathyDraft['tone'] =
    args.sentiment === 'angry' ? 'apologetic'
    : args.sentiment === 'frustrated' ? 'reassuring'
    : args.sentiment === 'appreciative' ? 'thankful'
    : 'professional';

  const greetingName = args.tenantDisplayName ?? '';
  const body = renderBody({
    language: args.language,
    tone,
    category: args.category,
    referenceId: args.referenceId,
    greetingName,
  });

  return Object.freeze({
    body,
    tone,
    draftStatus: 'queued-for-owner-review',
    autoSendable: false,
    language: args.language,
  });
}

function renderBody(args: {
  readonly language: 'en' | 'sw' | 'mixed';
  readonly tone: EmpathyDraft['tone'];
  readonly category: ComplaintCategory;
  readonly referenceId: string;
  readonly greetingName: string;
}): string {
  const { language, tone, category, referenceId, greetingName } = args;
  const isSw = language === 'sw';
  const name = greetingName ? ` ${greetingName}` : '';
  if (isSw) {
    if (tone === 'apologetic') {
      return `Habari${name}, nakuomba radhi kwa usumbufu huu. Nimepokea malalamiko yako kuhusu ${swCategoryLabel(category)} (kumbukumbu: ${referenceId}). Tunashughulikia sasa.`;
    }
    if (tone === 'reassuring') {
      return `Habari${name}, nakushukuru kwa kunijulisha. Suala lako kuhusu ${swCategoryLabel(category)} (kumbukumbu: ${referenceId}) limepokelewa na linafanyiwa kazi.`;
    }
    if (tone === 'thankful') {
      return `Habari${name}, asante kwa maoni yako kuhusu ${swCategoryLabel(category)} (kumbukumbu: ${referenceId}).`;
    }
    return `Habari${name}, nimepokea maelezo yako kuhusu ${swCategoryLabel(category)} (kumbukumbu: ${referenceId}). Tutarudi kwako hivi karibuni.`;
  }
  if (tone === 'apologetic') {
    return `Hello${name}, I am sorry for the inconvenience. Your complaint about ${enCategoryLabel(category)} (ref: ${referenceId}) has been received and is being acted on now.`;
  }
  if (tone === 'reassuring') {
    return `Hello${name}, thank you for flagging this. Your concern about ${enCategoryLabel(category)} (ref: ${referenceId}) has been logged and is being worked on.`;
  }
  if (tone === 'thankful') {
    return `Hello${name}, thank you for your feedback on ${enCategoryLabel(category)} (ref: ${referenceId}).`;
  }
  return `Hello${name}, your message about ${enCategoryLabel(category)} (ref: ${referenceId}) has been received. We will respond shortly.`;
}

function enCategoryLabel(c: ComplaintCategory): string {
  switch (c) {
    case 'maintenance': return 'a maintenance issue';
    case 'billing': return 'a billing matter';
    case 'neighbor-noise': return 'a noise concern';
    case 'lease-question': return 'a lease question';
    case 'fair-treatment': return 'a fair-treatment concern';
    case 'safety': return 'a safety concern';
    case 'privacy': return 'a privacy concern';
    case 'other': return 'your message';
  }
}

function swCategoryLabel(c: ComplaintCategory): string {
  switch (c) {
    case 'maintenance': return 'matengenezo';
    case 'billing': return 'malipo';
    case 'neighbor-noise': return 'kelele za jirani';
    case 'lease-question': return 'mkataba';
    case 'fair-treatment': return 'haki na usawa';
    case 'safety': return 'usalama';
    case 'privacy': return 'faragha';
    case 'other': return 'ujumbe wako';
  }
}
