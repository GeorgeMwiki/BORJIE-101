/**
 * Composite payout provider — picks a concrete adapter per row based
 * on `(currency, destination)`.
 *
 * Routing rules
 * -------------
 *  - `currency === 'KES'` AND destination looks like an msisdn -> Mpesa B2C
 *  - everything else                                            -> EFT stub
 *
 * If neither adapter is configured the factory returns `null`; the
 * caller (typically `createStubPayoutProvider`'s composition entry
 * point) falls back to a stub so dev / test environments continue to
 * work without live credentials.
 */

import type {
  PayoutProvider,
  PayoutProviderInput,
  PayoutProviderResult,
} from '../stub-payout-provider';
import { normaliseMsisdn } from './types';

export type CompositePayoutDeps = {
  readonly mpesa?: PayoutProvider;
  readonly eft?: PayoutProvider;
};

export function createCompositePayoutProvider(deps: CompositePayoutDeps): PayoutProvider | null {
  if (!deps.mpesa && !deps.eft) return null;

  async function send(input: PayoutProviderInput): Promise<PayoutProviderResult> {
    if (deps.mpesa && isMpesaCandidate(input)) {
      return deps.mpesa.send(input);
    }
    if (deps.eft) {
      return deps.eft.send(input);
    }
    // Mpesa is configured but the row is not Mpesa-eligible AND no EFT
    // adapter is wired. Fail loudly so the DLQ surfaces it.
    return {
      providerRef: `composite_unrouted_${input.idempotencyKey}`,
      status: 'failed',
      failureReason: `composite_no_adapter_for_${input.currency}`,
    };
  }

  return { send };
}

function isMpesaCandidate(input: PayoutProviderInput): boolean {
  if (input.currency !== 'KES') return false;
  return normaliseMsisdn(input.destination) !== null;
}
