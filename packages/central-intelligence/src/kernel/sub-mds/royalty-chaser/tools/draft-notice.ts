/**
 * `arrears.draft_notice` — DRAFT-only.
 *
 * Produces a draft of a formal overdue-payment notice for owner review.
 * **Never auto-files.** The owner reviews, signs, and routes to the
 * HQ-tier `platform.file_demand_notice` if they choose. This sub-MD's
 * draft is the SECOND-to-last step, not the last.
 */

export interface DraftNoticeArgs {
  readonly tenantName: string;
  readonly leaseId: string;
  readonly propertyAddress: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly daysOverdue: number;
  readonly noticeKind: 'pay-or-quit' | 'demand-letter' | 'final-warning';
  readonly jurisdiction: 'KE' | 'TZ' | 'UG' | 'OTHER';
  readonly language: 'en' | 'sw' | 'mixed';
  readonly ownerSignature: string;
}

export interface DraftedNotice {
  readonly kind: DraftNoticeArgs['noticeKind'];
  readonly jurisdiction: DraftNoticeArgs['jurisdiction'];
  readonly subject: string;
  readonly body: string;
  readonly mandatoryReviewCheckpoints: ReadonlyArray<string>;
  readonly draftStatus: 'queued-for-owner-review';
  /** The sub-MD MUST NOT route this; filing any notice is HQ-tier. */
  readonly nextStepGuidance: string;
}

export function draftNotice(args: DraftNoticeArgs): DraftedNotice {
  const major = (args.amountMinor / 100).toFixed(0);
  const isSw = args.language === 'sw';
  const subject = renderSubject(args.noticeKind, isSw);
  const body = renderBody({ ...args, amountMajor: major });
  const checkpoints = checkpointsFor(args.jurisdiction, args.noticeKind);
  return Object.freeze({
    kind: args.noticeKind,
    jurisdiction: args.jurisdiction,
    subject,
    body,
    mandatoryReviewCheckpoints: Object.freeze(checkpoints),
    draftStatus: 'queued-for-owner-review',
    nextStepGuidance:
      'Owner must review for accuracy, sign, and (if proceeding) route through the HQ-tier demand-notice filing tool. arrears.draft_notice does NOT file.',
  });
}

function renderSubject(kind: DraftNoticeArgs['noticeKind'], sw: boolean): string {
  if (sw) {
    if (kind === 'pay-or-quit') return 'Taarifa rasmi: lipa deni lililochelewa';
    if (kind === 'demand-letter') return 'Barua ya madai ya rasmi';
    return 'Onyo la mwisho';
  }
  if (kind === 'pay-or-quit') return 'Formal notice: settle the overdue balance';
  if (kind === 'demand-letter') return 'Formal demand letter';
  return 'Final warning';
}

interface BodyArgs extends DraftNoticeArgs { readonly amountMajor: string }

function renderBody(args: BodyArgs): string {
  const isSw = args.language === 'sw';
  const lines: string[] = [];
  if (isSw) {
    lines.push(`Kwa ${args.tenantName},`);
    lines.push('');
    lines.push(`Hii ni taarifa rasmi ya rasimu (kwa marejeleo ya mmiliki kabla ya kusainiwa).`);
    lines.push(`Operesheni: ${args.propertyAddress}`);
    lines.push(`Mkataba: ${args.leaseId}`);
    lines.push(`Deni: ${args.currency} ${args.amountMajor}`);
    lines.push(`Kuchelewa: siku ${args.daysOverdue}`);
    lines.push('');
    lines.push('Tafadhali wasiliana na ofisi yetu kupanga malipo.');
    lines.push('');
    lines.push(`Sahihi (mmiliki): _________________`);
    lines.push(`${args.ownerSignature}`);
  } else {
    lines.push(`Dear ${args.tenantName},`);
    lines.push('');
    lines.push('This is a DRAFT notice prepared for owner review and signature.');
    lines.push(`Operation: ${args.propertyAddress}`);
    lines.push(`Contract: ${args.leaseId}`);
    lines.push(`Outstanding balance: ${args.currency} ${args.amountMajor}`);
    lines.push(`Days overdue: ${args.daysOverdue}`);
    lines.push('');
    lines.push('Please contact our office to arrange payment or a payment plan.');
    lines.push('');
    lines.push(`Owner signature: _________________`);
    lines.push(`${args.ownerSignature}`);
  }
  return lines.join('\n');
}

function checkpointsFor(j: DraftNoticeArgs['jurisdiction'], kind: DraftNoticeArgs['noticeKind']): string[] {
  const base = [
    'verify counterparty name and contract id against latest record',
    'confirm amount matches latest invoice + agreed fees',
    'confirm days-overdue from books reconciled within 24h',
    'check no partial payment posted since classifier run',
    'verify owner is the named party on the contract',
  ];
  if (j === 'KE') {
    base.push('per Kenya debt-recovery practice: confirm demand period before any further step; verify');
  } else if (j === 'TZ') {
    base.push('per Tanzania Mining Act royalty-recovery rules: confirm statutory demand period; verify in jurisdictional MCP server');
  }
  if (kind === 'pay-or-quit') base.push('confirm the settle-or-escalate window is at least the statutory minimum');
  return base;
}
