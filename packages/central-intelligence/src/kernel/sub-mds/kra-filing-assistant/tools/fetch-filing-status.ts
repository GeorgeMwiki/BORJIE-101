/**
 * `kra.fetch_filing_status` — read tier.
 *
 * Polls eRITS for the status of a previously-submitted filing.
 * Port-based: production wires the KRA gateway / process-intel server;
 * tests inject a fixture.
 */

export type FilingStatus =
  | 'pending-submission'
  | 'received'
  | 'under-review'
  | 'accepted'
  | 'rejected'
  | 'amendment-requested';

export interface FilingStatusPort {
  readStatus(args: {
    readonly ownerPin: string;
    readonly periodYear: number;
    readonly periodMonth: number;
    readonly filingRef?: string;
  }): Promise<{
    readonly status: FilingStatus;
    readonly receiptNumber?: string;
    readonly rejectionReason?: string;
    readonly amendmentInstructions?: string;
    readonly fetchedAtMs: number;
  }>;
}

export interface FetchFilingStatusArgs {
  readonly port: FilingStatusPort;
  readonly ownerPin: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly filingRef?: string;
}

export interface FetchFilingStatusResult {
  readonly status: FilingStatus;
  readonly receiptNumber?: string;
  readonly rejectionReason?: string;
  readonly amendmentInstructions?: string;
  readonly suggestedOwnerAction:
    | 'wait'
    | 'investigate-rejection'
    | 'submit-amendment'
    | 'archive-receipt'
    | 'review-with-tax-advisor';
  readonly fetchedAtMs: number;
}

export async function fetchFilingStatus(
  args: FetchFilingStatusArgs,
): Promise<FetchFilingStatusResult> {
  const s = await args.port.readStatus({
    ownerPin: args.ownerPin,
    periodYear: args.periodYear,
    periodMonth: args.periodMonth,
    ...(args.filingRef ? { filingRef: args.filingRef } : {}),
  });
  const suggestedOwnerAction: FetchFilingStatusResult['suggestedOwnerAction'] =
    s.status === 'accepted' ? 'archive-receipt'
    : s.status === 'rejected' ? 'investigate-rejection'
    : s.status === 'amendment-requested' ? 'submit-amendment'
    : s.status === 'under-review' ? 'review-with-tax-advisor'
    : 'wait';
  return Object.freeze({
    status: s.status,
    ...(s.receiptNumber ? { receiptNumber: s.receiptNumber } : {}),
    ...(s.rejectionReason ? { rejectionReason: s.rejectionReason } : {}),
    ...(s.amendmentInstructions ? { amendmentInstructions: s.amendmentInstructions } : {}),
    suggestedOwnerAction,
    fetchedAtMs: s.fetchedAtMs,
  });
}
