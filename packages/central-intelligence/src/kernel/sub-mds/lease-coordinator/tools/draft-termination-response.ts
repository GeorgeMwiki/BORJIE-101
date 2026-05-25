/**
 * `lease.draft_termination_response` — DRAFT-only.
 *
 * Generates a tenant-facing reply to a termination request. Owner
 * reviews and signs before send. Never commits a termination effective
 * date.
 */

import type { ClassifiedTermination, TerminationKind } from './classify-termination-request.js';

export interface DraftTerminationResponseArgs {
  readonly classification: ClassifiedTermination;
  readonly tenantName: string;
  readonly leaseId: string;
  readonly minNoticeDays: number;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly ownerSignature: string;
}

export interface DraftedTerminationResponse {
  readonly toneTag: 'understanding' | 'process-clarifying' | 'empathetic-urgent' | 'investigative';
  readonly subject: string;
  readonly body: string;
  readonly draftStatus: 'queued-for-owner-review';
  readonly suggestedOwnerAction:
    | 'acknowledge-notice'
    | 'request-formal-notice'
    | 'escalate-to-owner-urgent'
    | 'investigate-dispute';
}

export function draftTerminationResponse(args: DraftTerminationResponseArgs): DraftedTerminationResponse {
  const { classification } = args;
  const toneTag = pickTone(classification.kind);
  const suggestedOwnerAction = pickAction(classification.kind);
  const subject = renderSubject(classification.kind, args.language);
  const body = renderBody({
    kind: classification.kind,
    tenantName: args.tenantName,
    leaseId: args.leaseId,
    minNoticeDays: args.minNoticeDays,
    ownerSignature: args.ownerSignature,
    lang: args.language,
    ...(classification.noticeRequestedDate !== undefined
      ? { noticeRequestedDate: classification.noticeRequestedDate }
      : {}),
  });

  return Object.freeze({
    toneTag,
    subject,
    body,
    draftStatus: 'queued-for-owner-review',
    suggestedOwnerAction,
  });
}

function pickTone(kind: TerminationKind): DraftedTerminationResponse['toneTag'] {
  if (kind === 'urgent-emergency') return 'empathetic-urgent';
  if (kind === 'dispute-driven') return 'investigative';
  if (kind === 'exploratory') return 'process-clarifying';
  return 'understanding';
}

function pickAction(kind: TerminationKind): DraftedTerminationResponse['suggestedOwnerAction'] {
  if (kind === 'urgent-emergency') return 'escalate-to-owner-urgent';
  if (kind === 'dispute-driven') return 'investigate-dispute';
  if (kind === 'exploratory') return 'request-formal-notice';
  return 'acknowledge-notice';
}

function renderSubject(kind: TerminationKind, lang: 'en' | 'sw' | 'mixed'): string {
  const sw = lang === 'sw';
  if (kind === 'urgent-emergency') return sw ? 'Tumesikia ombi lako la haraka' : 'We heard your urgent request';
  if (kind === 'dispute-driven') return sw ? 'Tunashughulikia malalamiko yako' : 'We are looking into your concern';
  if (kind === 'exploratory') return sw ? 'Utaratibu wa kumaliza mkataba' : 'How the termination process works';
  return sw ? 'Tumepokea taarifa yako ya kuondoka' : 'We received your notice';
}

function renderBody(args: {
  readonly kind: TerminationKind;
  readonly tenantName: string;
  readonly leaseId: string;
  readonly minNoticeDays: number;
  readonly ownerSignature: string;
  readonly lang: 'en' | 'sw' | 'mixed';
  readonly noticeRequestedDate?: string;
}): string {
  const sw = args.lang === 'sw';
  const lines: string[] = [];
  if (sw) lines.push(`Habari ${args.tenantName},`);
  else lines.push(`Dear ${args.tenantName},`);
  lines.push('');
  if (args.kind === 'notice-of-intent') {
    if (sw) {
      lines.push(`Tumepokea taarifa yako ya nia ya kuondoka kutoka kwa mkataba #${args.leaseId}.`);
      if (args.noticeRequestedDate) lines.push(`Tarehe uliyopendekeza: ${args.noticeRequestedDate}.`);
      lines.push(`Mkataba unahitaji siku ${args.minNoticeDays} za taarifa.`);
    } else {
      lines.push(`We received your notice of intent for lease #${args.leaseId}.`);
      if (args.noticeRequestedDate) lines.push(`Date you proposed: ${args.noticeRequestedDate}.`);
      lines.push(`The lease requires ${args.minNoticeDays} days' notice.`);
    }
  } else if (args.kind === 'urgent-emergency') {
    lines.push(sw
      ? 'Tunasikitika kusikia hali yako. Mmiliki anataarifiwa sasa hivi na atawasiliana nawe haraka.'
      : 'We are sorry to hear about your situation. The owner is being notified now and will contact you urgently.',
    );
  } else if (args.kind === 'dispute-driven') {
    lines.push(sw
      ? 'Tumepokea ujumbe wako. Tutachunguza suala lililotajwa na kuwasiliana nawe ndani ya siku 3.'
      : 'We received your message. We will investigate the issue you raised and respond within 3 business days.',
    );
  } else if (args.kind === 'exploratory') {
    if (sw) {
      lines.push(`Utaratibu wa kumaliza mkataba unahitaji taarifa rasmi ya siku ${args.minNoticeDays}.`);
      lines.push('Tafadhali tuma taarifa rasmi kwa maandishi tukiwa tayari kuanza mchakato.');
    } else {
      lines.push(`Termination requires ${args.minNoticeDays} days' written notice.`);
      lines.push('Please send a formal written notice when you are ready to begin the process.');
    }
  } else {
    lines.push(sw
      ? 'Tumepokea ujumbe wako. Tutawasiliana nawe baada ya mmiliki kupitia.'
      : 'We received your message. We will follow up after the owner has reviewed it.',
    );
  }
  lines.push('');
  lines.push(sw ? `Wako,\n${args.ownerSignature}` : `Best regards,\n${args.ownerSignature}`);
  return lines.join('\n');
}
