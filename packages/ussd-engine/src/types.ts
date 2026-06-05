/**
 * USSD engine — type system (LP-25).
 *
 * Feature-phone ingress for artisanal miners. A miner with no smartphone
 * dials a short code (e.g. *123#) and navigates a bilingual menu tree to
 * check a licence, see today's royalty due, log production, hear a payout
 * status, or reach the marketplace. USSD is the single biggest *capability*
 * gap for the low-bandwidth, feature-phone reality of Tanzanian mining.
 *
 * USSD constraints (Africa's Talking, the canonical TZ gateway):
 * - 180-second session timeout.
 * - ~182 characters max per screen.
 * - Numeric input only; cumulative `text` is "1*2*3".
 * - Plain text, no encryption — never echo a secret to a USSD screen.
 *
 * Every type is readonly. Producers build new objects; consumers never
 * mutate. There is NO direct DB/SDK access in this package — persistence is
 * injected through {@link UssdSessionStore}.
 *
 * @module @borjie/ussd-engine/types
 */

// ============================================================================
// Provider + language
// ============================================================================

/** Supported USSD gateway providers. */
export type UssdProvider = 'africas_talking' | 'twilio' | 'infobip';

/**
 * USSD languages. Borjie default is `en`; Tanzanian miners may toggle to
 * `sw`. The toggle is ABSOLUTE — when a language is active, zero text from
 * the other language appears on any screen (hard rule, CLAUDE.md).
 */
export type UssdLanguage = 'en' | 'sw';

// ============================================================================
// Tier (sender -> tier mapping origin)
// ============================================================================

/**
 * Resolved actor tier for the dialing MSISDN. Mirrors Borjie's role-gated
 * model (owner / manager / employee / buyer). `anonymous` is a phone we
 * could not resolve to any tenant member — it still gets a public menu
 * (marketplace browse, generic info) but no tenant-scoped data.
 */
export type UssdTier =
  | 'owner'
  | 'manager'
  | 'employee'
  | 'buyer'
  | 'anonymous';

// ============================================================================
// Session state (navigation FSM)
// ============================================================================

/**
 * States in the USSD navigation FSM. Re-skinned from LITFIN's lending flow
 * to a mining flow:
 *   - `licence`         -> active mining licence + expiry
 *   - `royalty`         -> royalty due / paid this period
 *   - `production_log`  -> log today's output (grams / tonnes)
 *   - `payout_status`   -> worker payout / settlement state
 *   - `marketplace`     -> latest mineral buy prices
 */
export type UssdSessionState =
  | 'initial'
  | 'main_menu'
  | 'licence'
  | 'licence_detail'
  | 'royalty'
  | 'royalty_detail'
  | 'production_log'
  | 'production_log_amount'
  | 'production_log_confirm'
  | 'payout_status'
  | 'marketplace'
  | 'marketplace_detail'
  | 'language_switch';

// ============================================================================
// Session
// ============================================================================

/** A USSD session — tracks the dialer's navigation state. Immutable. */
export interface UssdSession {
  readonly sessionId: string;
  /** Dialer MSISDN in E.164 where resolvable. */
  readonly phoneNumber: string;
  /** Resolved tenant id, or null for an unresolved (anonymous) caller. */
  readonly tenantId: string | null;
  /** Resolved actor (owner/worker/buyer) id, or null. */
  readonly actorId: string | null;
  readonly tier: UssdTier;
  readonly state: UssdSessionState;
  readonly language: UssdLanguage;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly expiresAt: string;
}

// ============================================================================
// Request / response (Africa's Talking shape)
// ============================================================================

/** Incoming USSD request from the gateway provider. */
export interface UssdRequest {
  readonly sessionId: string;
  readonly serviceCode: string;
  readonly phoneNumber: string;
  /** Cumulative input string, e.g. "" (first dial) or "1*2*3". */
  readonly text: string;
  readonly networkCode?: string;
  readonly provider?: UssdProvider;
}

/** Outgoing USSD response. `isEnd` => terminal screen (gateway hangs up). */
export interface UssdResponse {
  readonly message: string;
  readonly isEnd: boolean;
}

// ============================================================================
// Menu tree
// ============================================================================

/** A single selectable option in a USSD screen. */
export interface UssdMenuOption {
  readonly key: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly targetState: UssdSessionState;
  /** Minimum tier required to see this option. Defaults to `anonymous`. */
  readonly minTier?: UssdTier;
}

/** A node in the USSD menu tree. */
export interface UssdMenuNode {
  readonly id: UssdSessionState;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly options: readonly UssdMenuOption[];
  /** Dynamic nodes are built at request time from injected data. */
  readonly isDynamic?: boolean;
}

/** Complete static menu tree. */
export interface UssdMenu {
  readonly root: UssdMenuNode;
  readonly nodes: Readonly<Record<string, UssdMenuNode>>;
}

// ============================================================================
// Dynamic-screen data (provided by the host via data fetchers)
// ============================================================================

/** Active mining licence summary for a USSD screen. */
export interface UssdLicenceData {
  readonly licenceRef: string;
  readonly statusEn: string;
  readonly statusSw: string;
  /** ISO date string YYYY-MM-DD. */
  readonly expiresOn: string;
  readonly daysToExpiry: number;
}

/** Royalty position for the current period. */
export interface UssdRoyaltyData {
  readonly periodLabel: string;
  /** Amount in the tenant's primary currency minor unit count is NOT used;
   *  the host formats with formatCurrency, we carry the rendered string. */
  readonly amountDueDisplay: string;
  readonly amountPaidDisplay: string;
  readonly nextActionEn: string;
  readonly nextActionSw: string;
}

/** Worker payout / settlement status. */
export interface UssdPayoutData {
  readonly reference: string;
  readonly statusEn: string;
  readonly statusSw: string;
  readonly amountDisplay: string;
  readonly nextStepEn: string;
  readonly nextStepSw: string;
}

/** A single mineral price line for the marketplace screen. */
export interface UssdMarketplaceLine {
  readonly mineralEn: string;
  readonly mineralSw: string;
  readonly priceDisplay: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum characters per USSD screen (Africa's Talking). */
export const USSD_MAX_CHARS = 182;

/** Session TTL in seconds (Africa's Talking enforces ~180s). */
export const USSD_SESSION_TIMEOUT_SECONDS = 180;
