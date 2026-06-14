/**
 * Translation layer: buyer-mobile KYC wizard state → the api-gateway flat
 * `SubmitKycSchema` body (POST /api/v1/mining/buyers/kyc).
 *
 * The wizard collects nested step state (personal / nida / company / aml),
 * but the gateway's `SubmitKycSchema`
 * (services/api-gateway/src/routes/mining/_openapi/owner-cockpit-schemas.ts)
 * is FLAT. Posting the nested wizard state straight through 422'd and left
 * buyer onboarding dead. This is the single translation point — the wizard
 * never POSTs its own shape.
 *
 * Field mapping (only fields the gateway accepts; extras are dropped):
 *   name         ← personal.fullName        (the registering buyer's legal name)
 *   kind         ← buyerKind                 (BuyerKindEnum; defaults to 'trader')
 *   country      ← 'TZ'                       (launch jurisdiction; server default)
 *   tin          ← company.tin               (omitted when blank)
 *   contactName  ← personal.fullName
 *   contactEmail ← personal.email            (omitted when blank)
 *   contactPhone ← personal.phone            (omitted when blank)
 *   amlScreenResult ← 'pending'              (server runs the screen; never client-asserted)
 *
 * The NIDA step only carries document image URIs (no NIDA *number*), so
 * `nidaId` is left unset (it is optional on the gateway). `companyId` /
 * `licenceNumber` are not collected by this wizard and are omitted.
 */

import type { KycSubmission } from '@/types/kyc'

/**
 * Buyer kinds the gateway accepts (BuyerKindEnum). Kept in lock-step with
 * the server enum; if the gateway adds a kind, mirror it here.
 */
export type BuyerKind =
  | 'trader'
  | 'smelter'
  | 'refinery'
  | 'export_buyer'
  | 'bot'
  | 'broker'

export const BUYER_KINDS: readonly BuyerKind[] = [
  'trader',
  'smelter',
  'refinery',
  'export_buyer',
  'bot',
  'broker',
]

/** Default buyer kind when the wizard does not capture one explicitly. */
export const DEFAULT_BUYER_KIND: BuyerKind = 'trader'

/** Launch-jurisdiction country for KYC (ISO-3166 alpha-2). */
const DEFAULT_COUNTRY = 'TZ'

/** Flat body shape the gateway `SubmitKycSchema` validates. */
export interface SubmitKycBody {
  readonly name: string
  readonly kind: BuyerKind
  readonly country: string
  readonly tin?: string
  readonly nidaId?: string
  readonly contactName?: string
  readonly contactEmail?: string
  readonly contactPhone?: string
  readonly amlScreenResult: 'clear' | 'flagged' | 'pending'
}

function trimmed(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const out = value.trim()
  return out.length > 0 ? out : undefined
}

/**
 * Map the nested wizard `KycSubmission` into the flat gateway body. `kind`
 * is supplied by the caller (the wizard does not yet capture it) and
 * defaults to `'trader'` — the most common artisanal mineral buyer.
 */
export function toSubmitKycBody(
  submission: KycSubmission,
  kind: BuyerKind = DEFAULT_BUYER_KIND,
): SubmitKycBody {
  const name = trimmed(submission.personal.fullName) ?? ''
  const tin = trimmed(submission.company.tin)
  const contactEmail = trimmed(submission.personal.email)
  const contactPhone = trimmed(submission.personal.phone)

  return {
    name,
    kind,
    country: DEFAULT_COUNTRY,
    ...(tin ? { tin } : {}),
    contactName: name || undefined,
    ...(contactEmail ? { contactEmail } : {}),
    ...(contactPhone ? { contactPhone } : {}),
    amlScreenResult: 'pending',
  }
}
