/**
 * R37 — referral attribution MVP.
 *
 * Pragmatic in-process attribution surface that unblocks the core
 * referral use case today without a Drizzle migration (those are
 * blocked behind sibling-#222/#223/#224 work). The MVP lays the seam
 * so the post-pilot full-ledger pass can swap the in-memory store for
 * the planned `referrals` + `referral_rewards` tables without touching
 * the middleware or the rebate posting.
 *
 * Three pieces:
 *
 *   1. `parseReferralCode(headersOrQuery)` — pure extraction. Looks at
 *      the `?ref=` query, the `Borjie-Referral-Code` header, then the
 *      `borjie_ref` cookie. Returns `null` when nothing matches.
 *
 *   2. `IReferralAttributionStore` — write-only port. Default impl is
 *      an in-process `Map`; the post-pilot DB impl satisfies the same
 *      interface.
 *
 *   3. `attributeSignup(input, store)` — the actual MVP. Records the
 *      tenant ↔ referrer mapping with a 90-day attribution window so
 *      late-binding rebates (per `RewardJournalSpec`) can fire when
 *      the new tenant produces revenue. Idempotent on `tenantId`.
 *
 * The rebate ledger journaling is intentionally deferred — once the
 * sibling-DB migration ships, swap the in-process store for a Drizzle
 * adapter that ALSO emits `LedgerService.post()` calls on attribution.
 * The signature stays the same.
 */

const REFERRAL_CODE_REGEX = /^[A-Za-z0-9_-]{4,32}$/u;
const ATTRIBUTION_WINDOW_DAYS = 90;

export interface ReferralAttribution {
  readonly tenantId: string;
  readonly referrerCode: string;
  readonly attributedAt: string;
  readonly windowEndsAt: string;
  readonly source: 'query' | 'header' | 'cookie';
}

export interface AttributionInput {
  readonly tenantId: string;
  readonly referrerCode: string;
  readonly source: 'query' | 'header' | 'cookie';
  readonly now?: () => Date;
}

export interface IReferralAttributionStore {
  /** Idempotent on tenantId — repeated calls do NOT overwrite. */
  attribute(input: ReferralAttribution): Promise<ReferralAttribution>;
  read(tenantId: string): Promise<ReferralAttribution | null>;
  listByReferrer(referrerCode: string): Promise<readonly ReferralAttribution[]>;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a candidate referral code. Returns the SAME string trimmed
 * + lowercased OR `null` when the candidate violates the format.
 */
export function normaliseReferralCode(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!REFERRAL_CODE_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export interface RawSignupSources {
  readonly query?: Record<string, string | string[] | undefined>;
  readonly headers?: Record<string, string | undefined>;
  readonly cookies?: Record<string, string | undefined>;
}

/**
 * Extract a referral code from the canonical sources, in priority order:
 *   1. `?ref=` query param
 *   2. `Borjie-Referral-Code` header
 *   3. `borjie_ref` cookie
 *
 * Returns `null` when nothing matches.
 */
export function parseReferralCode(
  sources: RawSignupSources,
): { readonly code: string; readonly source: 'query' | 'header' | 'cookie' } | null {
  const fromQuery = pickOne(sources.query?.['ref']);
  const queryCode = normaliseReferralCode(fromQuery);
  if (queryCode) return { code: queryCode, source: 'query' };

  const headerCode = normaliseReferralCode(
    sources.headers?.['borjie-referral-code'] ??
      sources.headers?.['Borjie-Referral-Code'],
  );
  if (headerCode) return { code: headerCode, source: 'header' };

  const cookieCode = normaliseReferralCode(sources.cookies?.['borjie_ref']);
  if (cookieCode) return { code: cookieCode, source: 'cookie' };

  return null;
}

function pickOne(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Build the canonical attribution envelope. Pure — the caller writes
 * it via the store of their choice.
 */
export function buildAttribution(input: AttributionInput): ReferralAttribution {
  const now = (input.now ?? (() => new Date()))();
  const ends = new Date(
    now.getTime() + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  return Object.freeze({
    tenantId: input.tenantId,
    referrerCode: input.referrerCode,
    attributedAt: now.toISOString(),
    windowEndsAt: ends.toISOString(),
    source: input.source,
  });
}

// ─────────────────────────────────────────────────────────────────────
// In-process store — replace with Drizzle adapter post-migration.
// ─────────────────────────────────────────────────────────────────────

export class InProcessReferralAttributionStore implements IReferralAttributionStore {
  private readonly byTenant = new Map<string, ReferralAttribution>();

  async attribute(input: ReferralAttribution): Promise<ReferralAttribution> {
    const existing = this.byTenant.get(input.tenantId);
    if (existing) return existing;
    this.byTenant.set(input.tenantId, input);
    return input;
  }

  async read(tenantId: string): Promise<ReferralAttribution | null> {
    return this.byTenant.get(tenantId) ?? null;
  }

  async listByReferrer(referrerCode: string): Promise<readonly ReferralAttribution[]> {
    return [...this.byTenant.values()].filter(
      (a) => a.referrerCode === referrerCode,
    );
  }

  /** Test helper — fully drains the store between cases. */
  clear(): void {
    this.byTenant.clear();
  }
}

/**
 * High-level orchestrator: extract the code, build the envelope,
 * persist via the store. Idempotent on `tenantId`. Returns `null`
 * when no referral code was present (the signup proceeds normally).
 */
export async function attributeSignup(
  tenantId: string,
  sources: RawSignupSources,
  store: IReferralAttributionStore,
  now?: () => Date,
): Promise<ReferralAttribution | null> {
  const parsed = parseReferralCode(sources);
  if (!parsed) return null;
  const envelope = buildAttribution({
    tenantId,
    referrerCode: parsed.code,
    source: parsed.source,
    ...(now ? { now } : {}),
  });
  return store.attribute(envelope);
}
