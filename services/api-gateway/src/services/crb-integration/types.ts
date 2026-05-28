/**
 * Credit Reference Bureau (CRB) integration — shared shapes.
 *
 * Wave CRB-INTEGRATION. Borjie's owner cockpit asks Mr. Mwikila to
 * pull a counterparty's CRB report before signing a contract or
 * onboarding a major buyer. The provider seam below lets the gateway
 * swap between Creditinfo TZ, TransUnion TZ, and a mock provider
 * keyed off the `CRB_PROVIDER` env-var, without coupling the route
 * code to a specific vendor.
 */

export interface CrbReportRequest {
  /** Tanzanian Tax Identification Number (10 digits). */
  readonly tin: string;
  /** National Identification Authority (NIDA) id (20 digits). */
  readonly nida: string;
  /** Optional counterparty display name for audit + caching. */
  readonly displayName?: string;
}

export interface CrbCreditLine {
  readonly creditor: string;
  readonly facilityType: 'overdraft' | 'term-loan' | 'invoice-finance' | 'guarantee' | 'other';
  readonly originalAmountTzs: number;
  readonly outstandingTzs: number;
  readonly openedAt: string;
  readonly maturityAt: string | null;
  readonly status: 'current' | 'arrears' | 'default' | 'settled' | 'restructured';
}

export interface CrbHistoryEntry {
  readonly observedAt: string;
  readonly score: number;
  readonly reason: string;
}

export interface CrbDefaultEntry {
  readonly creditor: string;
  readonly amountTzs: number;
  readonly defaultedAt: string;
  readonly resolvedAt: string | null;
}

export interface CrbReport {
  readonly provider: 'creditinfo' | 'transunion' | 'mock';
  readonly subject: {
    readonly tin: string;
    readonly nida: string;
    readonly displayName: string | null;
  };
  /** 300-900 normalised score. Higher = lower risk. */
  readonly score: number;
  readonly scoreBand: 'excellent' | 'good' | 'fair' | 'poor' | 'unrated';
  readonly openCredits: ReadonlyArray<CrbCreditLine>;
  readonly defaults: ReadonlyArray<CrbDefaultEntry>;
  readonly history: ReadonlyArray<CrbHistoryEntry>;
  readonly pulledAt: string;
  readonly cacheable: boolean;
  readonly degraded: boolean;
}

export interface CrbProvider {
  readonly name: 'creditinfo' | 'transunion' | 'mock';
  fetchReport(req: CrbReportRequest): Promise<CrbReport>;
}
