/**
 * USSD engine — injected ports (LP-25).
 *
 * The state machine is pure routing logic; everything with a side effect is
 * a port the host wires at boot. There is NO Supabase / Drizzle / HTTP
 * import in this package — the api-gateway composition root supplies real
 * adapters; tests supply in-memory fakes.
 *
 * @module @borjie/ussd-engine/ports
 */

import type {
  UssdLanguage,
  UssdSession,
  UssdSessionState,
  UssdTier,
  UssdLicenceData,
  UssdRoyaltyData,
  UssdPayoutData,
  UssdMarketplaceLine,
} from './types.js';

/**
 * Persistence port for USSD sessions. The host backs this with the
 * `ussd_sessions` table (RLS service-role) or an in-memory map in tests.
 * All methods are async and immutable — `update` returns a fresh session.
 */
export interface UssdSessionStore {
  get(sessionId: string): Promise<UssdSession | null>;
  create(session: UssdSession): Promise<UssdSession>;
  update(
    sessionId: string,
    updates: {
      readonly state?: UssdSessionState;
      readonly language?: UssdLanguage;
      readonly data?: Readonly<Record<string, unknown>>;
    },
  ): Promise<UssdSession>;
  /** Mark a session ended/expired. */
  end(sessionId: string): Promise<void>;
}

/**
 * Resolves a dialing MSISDN to a tenant + actor + tier. The host queries the
 * member directory; an unresolved phone returns `tier: 'anonymous'` so the
 * caller still gets the public menu. NEVER throws — resolution failure is a
 * normal anonymous path, not an error.
 */
export interface UssdIdentityResolver {
  resolve(phoneNumber: string): Promise<{
    readonly tenantId: string | null;
    readonly actorId: string | null;
    readonly tier: UssdTier;
    /** Preferred language if the member has one set. */
    readonly language?: UssdLanguage;
  }>;
}

/**
 * Read-only data fetchers for the dynamic screens. Each is tenant-scoped by
 * the host (the api-gateway binds `app.current_tenant_id` before calling).
 * Returning `null` renders the matching "nothing on file" screen.
 *
 * Fail-soft by contract: a fetcher that throws is caught by the handler and
 * rendered as a generic error screen, never a crash.
 */
export interface UssdDataPort {
  fetchLicence(session: UssdSession): Promise<UssdLicenceData | null>;
  fetchRoyalty(session: UssdSession): Promise<UssdRoyaltyData | null>;
  fetchPayout(session: UssdSession): Promise<UssdPayoutData | null>;
  fetchMarketplace(session: UssdSession): Promise<readonly UssdMarketplaceLine[]>;
  /**
   * Persist a production-log entry (grams). Returns true on success. The
   * money/ledger path is NOT here — this only records raw production; royalty
   * settlement stays on the gateway's authoritative LedgerService path.
   */
  recordProduction(session: UssdSession, grams: number): Promise<boolean>;
}

/**
 * Optional analytics sink for request/response pairs. Fire-and-forget; the
 * handler never awaits it on the hot path.
 */
export interface UssdAuditSink {
  log(entry: {
    readonly sessionId: string;
    readonly phoneNumber: string;
    readonly serviceCode: string;
    readonly input: string;
    readonly response: string;
    readonly isEnd: boolean;
  }): void;
}

/** Injectable clock so tests are deterministic. */
export interface UssdClock {
  now(): Date;
}

/** Default wall-clock implementation. */
export const systemClock: UssdClock = { now: () => new Date() };
