/**
 * `arrears.classify_severity` — read tier.
 *
 * Bucket: mild (1-7d) / moderate (8-21d) / serious (22-44d) /
 * critical (45d+). Tenant history (first-delinquency, repeat, chronic)
 * shifts the bucket up by one level (max critical).
 *
 * The classifier never escalates past `critical`; eviction filing is
 * an HQ-tier action outside this sub-MD's tool-belt.
 */

export type ArrearsSeverity = 'mild' | 'moderate' | 'serious' | 'critical';
export type TenantHistory = 'first-delinquency' | 'repeat' | 'chronic' | 'unknown';

export interface ClassifySeverityArgs {
  readonly daysOverdue: number;
  readonly amountMinor: number;
  readonly monthlyRentMinor: number;
  readonly tenantHistory: TenantHistory;
  /** True if the tenant has made any partial payment in the current
   *  arrears cycle. Softens the escalation. */
  readonly partialPaymentSeen?: boolean;
}

export interface ClassifiedSeverity {
  readonly severity: ArrearsSeverity;
  readonly rawBucket: ArrearsSeverity;
  readonly recommendedAction:
    | 'soft-reminder'
    | 'firm-reminder'
    | 'payment-plan-offer'
    | 'escalate-to-call'
    | 'draft-notice-for-owner';
  readonly rationale: string;
}

const SEVERITY_ORDER: ReadonlyArray<ArrearsSeverity> = ['mild', 'moderate', 'serious', 'critical'];

export function classifySeverity(args: ClassifySeverityArgs): ClassifiedSeverity {
  let raw: ArrearsSeverity;
  if (args.daysOverdue <= 7) raw = 'mild';
  else if (args.daysOverdue <= 21) raw = 'moderate';
  else if (args.daysOverdue <= 44) raw = 'serious';
  else raw = 'critical';

  // Amount weight: if amount is > 1.5 × monthly rent, bump one level
  let amountBump = 0;
  if (args.monthlyRentMinor > 0 && args.amountMinor >= args.monthlyRentMinor * 1.5) {
    amountBump = 1;
  }

  let historyBump = 0;
  if (args.tenantHistory === 'repeat') historyBump = 1;
  else if (args.tenantHistory === 'chronic') historyBump = 2;

  // Partial payment softens by one level
  let softener = 0;
  if (args.partialPaymentSeen === true) softener = -1;

  const rawIdx = SEVERITY_ORDER.indexOf(raw);
  const finalIdx = Math.max(0, Math.min(SEVERITY_ORDER.length - 1, rawIdx + amountBump + historyBump + softener));
  const severity = SEVERITY_ORDER[finalIdx]!;

  // When a partial payment is seen, action should still favor offering
  // a plan if the unsoftened bucket was moderate (good-faith effort
  // deserves a plan, not a soft reminder).
  const actionBucket: ArrearsSeverity =
    args.partialPaymentSeen === true && (raw === 'moderate' || raw === 'serious')
      ? 'moderate'
      : severity;
  const recommendedAction = pickAction(actionBucket, args.partialPaymentSeen === true);

  const rationale = [
    `${args.daysOverdue}d overdue → ${raw}`,
    amountBump > 0 ? `amount ${(args.amountMinor / args.monthlyRentMinor).toFixed(1)}× rent` : null,
    historyBump > 0 ? `history=${args.tenantHistory}` : null,
    softener < 0 ? 'partial-payment-credit' : null,
  ].filter(Boolean).join('; ');

  return Object.freeze({ severity, rawBucket: raw, recommendedAction, rationale });
}

function pickAction(s: ArrearsSeverity, partial: boolean): ClassifiedSeverity['recommendedAction'] {
  if (s === 'mild') return 'soft-reminder';
  if (s === 'moderate') return partial ? 'payment-plan-offer' : 'firm-reminder';
  if (s === 'serious') return 'escalate-to-call';
  return 'draft-notice-for-owner';
}
