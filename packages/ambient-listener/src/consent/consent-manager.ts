/**
 * Consent manager — single source of truth for "may Mr. Mwikila listen
 * to this user on this channel right now?"
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decision 4 — 90-day re-consent + 24-hour employee opt-out. Decision 3
 * privacy tiers are enforced by the repositories' read filters, not by
 * the consent manager itself.
 *
 * Every grant/revoke writes through the audit-chain port. The manager
 * is pure — no clock side-effects, no I/O beyond the injected repo +
 * audit chain.
 */

import {
  RE_CONSENT_WINDOW_DAYS,
  type AmbientChannel,
  type AmbientConsent,
  type AmbientConsentsRepository,
  type AuditChainPort,
  type ConsentState,
} from '../types.js';

export interface ConsentManagerDeps {
  readonly repo: AmbientConsentsRepository;
  readonly audit: AuditChainPort;
  /** Test seam — defaults to `() => new Date()`. */
  readonly clock?: () => Date;
}

export interface GrantArgs {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
  readonly granted_by: string;
  /** Per spec §6 — sentiment is a separate, explicit axis. */
  readonly sentiment_consent?: boolean;
}

export interface RevokeArgs {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
  readonly revoked_by: string;
}

export interface CheckArgs {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: AmbientChannel;
}

export interface CheckResult {
  /** Should the pipeline proceed? `false` ⇒ silent disable. */
  readonly may_listen: boolean;
  /** Effective state (always one of `not-set | granted | revoked` plus expired marker). */
  readonly effective_state: ConsentState | 'expired';
  /** Underlying row (null when not-set). */
  readonly consent: AmbientConsent | null;
}

export interface ConsentManager {
  grant(args: GrantArgs): Promise<AmbientConsent>;
  revoke(args: RevokeArgs): Promise<AmbientConsent>;
  check(args: CheckArgs): Promise<CheckResult>;
  /**
   * Returns true when an existing `granted` row's `granted_at +
   * RE_CONSENT_WINDOW_DAYS < now`. Used by the pipeline to silent-
   * disable expired grants per FOUNDER_LOCKED Decision 4.4.
   */
  mustReConsent(args: CheckArgs): Promise<boolean>;
}

export function createConsentManager(
  deps: ConsentManagerDeps,
): ConsentManager {
  const clock = deps.clock ?? (() => new Date());

  async function readNow(): Promise<Date> {
    return clock();
  }

  async function grant(args: GrantArgs): Promise<AmbientConsent> {
    const now = await readNow();
    const audit_hash = await deps.audit.append({
      op: 'ambient.consent.grant',
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      channel: args.channel,
      granted_by: args.granted_by,
      sentiment_consent: args.sentiment_consent ?? false,
      at: now.toISOString(),
    });
    const consent: AmbientConsent = {
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      channel: args.channel,
      consent_state: 'granted',
      sentiment_consent: args.sentiment_consent ?? false,
      granted_at: now.toISOString(),
      revoked_at: null,
      granted_by: args.granted_by,
      audit_hash,
    };
    await deps.repo.upsert(consent);
    return consent;
  }

  async function revoke(args: RevokeArgs): Promise<AmbientConsent> {
    const now = await readNow();
    const existing = await deps.repo.get(
      args.tenant_id,
      args.user_id,
      args.channel,
    );
    const audit_hash = await deps.audit.append({
      op: 'ambient.consent.revoke',
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      channel: args.channel,
      revoked_by: args.revoked_by,
      at: now.toISOString(),
    });
    const consent: AmbientConsent = {
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      channel: args.channel,
      consent_state: 'revoked',
      sentiment_consent: existing?.sentiment_consent ?? false,
      granted_at: existing?.granted_at ?? null,
      revoked_at: now.toISOString(),
      granted_by: existing?.granted_by ?? null,
      audit_hash,
    };
    await deps.repo.upsert(consent);
    return consent;
  }

  async function check(args: CheckArgs): Promise<CheckResult> {
    const consent = await deps.repo.get(
      args.tenant_id,
      args.user_id,
      args.channel,
    );
    if (!consent || consent.consent_state === 'not-set') {
      return {
        may_listen: false,
        effective_state: 'not-set',
        consent,
      };
    }
    if (consent.consent_state === 'revoked') {
      return {
        may_listen: false,
        effective_state: 'revoked',
        consent,
      };
    }
    // granted — but check 90-day window.
    if (isExpired(consent, await readNow())) {
      return {
        may_listen: false,
        effective_state: 'expired',
        consent,
      };
    }
    return {
      may_listen: true,
      effective_state: 'granted',
      consent,
    };
  }

  async function mustReConsent(args: CheckArgs): Promise<boolean> {
    const consent = await deps.repo.get(
      args.tenant_id,
      args.user_id,
      args.channel,
    );
    if (!consent || consent.consent_state !== 'granted') return false;
    return isExpired(consent, await readNow());
  }

  return { grant, revoke, check, mustReConsent };
}

/**
 * `true` when the `granted_at` is older than RE_CONSENT_WINDOW_DAYS.
 * Exposed for unit tests + the pipeline's silent-disable counter.
 */
export function isExpired(consent: AmbientConsent, now: Date): boolean {
  if (consent.consent_state !== 'granted') return false;
  if (!consent.granted_at) return false;
  const grantedMs = new Date(consent.granted_at).getTime();
  const windowMs = RE_CONSENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - grantedMs > windowMs;
}
