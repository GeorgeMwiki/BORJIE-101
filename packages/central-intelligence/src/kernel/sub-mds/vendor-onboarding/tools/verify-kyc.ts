/**
 * `vendor.verify_kyc` — read tier.
 *
 * Calls the appropriate jurisdictional MCP server for KYC: NIDA (TZ)
 * / Huduma (KE) / NIN (UG). Adapter pattern — production wires the
 * MCP client; tests inject a fake port.
 *
 * The function returns a structured verdict; it never throws on a
 * KYC failure (that's data, not an error).
 */

export type KycJurisdiction = 'KE' | 'TZ' | 'UG' | 'OTHER';

export interface KycLookupResult {
  readonly verified: boolean;
  readonly reason?: string;
  readonly fullNameOnRecord?: string;
  readonly lookupSourceTag: string;
  readonly checkedAtMs: number;
}

export interface KycLookupPort {
  /** Production wires the MCP client; tests inject. */
  lookup(args: {
    readonly jurisdiction: KycJurisdiction;
    readonly idNumber: string;
    readonly claimedName: string;
  }): Promise<KycLookupResult>;
}

export interface VerifyKycArgs {
  readonly jurisdiction: KycJurisdiction;
  /** Sensitive — the wire format MUST be a hash or token, not the
   *  raw id. Sub-MD never logs this in clear text. */
  readonly idNumberToken: string;
  readonly claimedName: string;
  readonly port: KycLookupPort;
}

export interface VerifyKycResult {
  readonly status: 'verified' | 'mismatch' | 'not-found' | 'unsupported-jurisdiction' | 'error';
  readonly fullNameOnRecord?: string;
  readonly mismatchedFields?: ReadonlyArray<string>;
  readonly lookupSourceTag?: string;
  readonly checkedAtMs?: number;
  readonly reason?: string;
}

export async function verifyKyc(args: VerifyKycArgs): Promise<VerifyKycResult> {
  if (args.jurisdiction === 'OTHER') {
    return Object.freeze({
      status: 'unsupported-jurisdiction',
      reason: 'jurisdictional KYC adapter not configured',
    });
  }
  try {
    const r = await args.port.lookup({
      jurisdiction: args.jurisdiction,
      idNumber: args.idNumberToken,
      claimedName: args.claimedName,
    });
    if (!r.verified) {
      return Object.freeze({
        status: 'not-found',
        lookupSourceTag: r.lookupSourceTag,
        checkedAtMs: r.checkedAtMs,
        reason: r.reason ?? 'no record found',
      });
    }
    if (r.fullNameOnRecord && !nameMatches(args.claimedName, r.fullNameOnRecord)) {
      return Object.freeze({
        status: 'mismatch',
        fullNameOnRecord: r.fullNameOnRecord,
        mismatchedFields: Object.freeze(['name']),
        lookupSourceTag: r.lookupSourceTag,
        checkedAtMs: r.checkedAtMs,
      });
    }
    return Object.freeze({
      status: 'verified',
      ...(r.fullNameOnRecord ? { fullNameOnRecord: r.fullNameOnRecord } : {}),
      lookupSourceTag: r.lookupSourceTag,
      checkedAtMs: r.checkedAtMs,
    });
  } catch (err) {
    return Object.freeze({
      status: 'error',
      reason: err instanceof Error ? err.message : 'kyc-lookup-failed',
    });
  }
}

function nameMatches(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
  return norm(a) === norm(b);
}
