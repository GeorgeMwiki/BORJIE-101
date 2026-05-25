/**
 * Step-up MFA orchestrator.
 *
 * For "sensitive actions" — adding a payout method, exporting tenant
 * data, changing tenant owner — re-prompt for fresh MFA even if the
 * session was already authenticated.
 *
 * Rule: an `action` is satisfied if the user completed an MFA challenge
 * within `freshnessMs` of the action. Otherwise we open a new challenge
 * and tell the caller to gate the action behind it.
 *
 * The store is pluggable so distributed deploys can back it with Redis
 * — the in-memory implementation is the default and is sufficient for
 * single-process workers.
 */

import type {
  IdentifierString,
  MFAChallenge,
  MFAChannel,
  TenantId,
  UserId,
} from '../types.js';

export interface StepUpStore {
  saveChallenge(c: MFAChallenge): Promise<void>;
  getChallenge(id: IdentifierString): Promise<MFAChallenge | null>;
  markSatisfied(id: IdentifierString, at: number): Promise<void>;
  /** Most-recent satisfied challenge for the user across any channel. */
  lastSatisfiedAt(userId: UserId, tenantId: TenantId): Promise<number | null>;
}

export function createInMemoryStepUpStore(): StepUpStore {
  const byId = new Map<IdentifierString, MFAChallenge>();
  const lastSatByUser = new Map<string, number>();

  const userKey = (u: UserId, t: TenantId): string => `${t}:${u}`;

  return {
    async saveChallenge(c) {
      byId.set(c.id, c);
    },
    async getChallenge(id) {
      return byId.get(id) ?? null;
    },
    async markSatisfied(id, at) {
      const c = byId.get(id);
      if (!c) return;
      const updated: MFAChallenge = { ...c, satisfiedAt: at };
      byId.set(id, updated);
      const k = userKey(c.userId, c.tenantId);
      const prev = lastSatByUser.get(k) ?? 0;
      if (at > prev) lastSatByUser.set(k, at);
    },
    async lastSatisfiedAt(userId, tenantId) {
      return lastSatByUser.get(userKey(userId, tenantId)) ?? null;
    },
  };
}

export interface StepUpServiceOptions {
  readonly store: StepUpStore;
  readonly freshnessMs: number; // e.g. 5 * 60 * 1000
  readonly challengeTTLms?: number;
  readonly now?: () => number;
  readonly newId?: () => IdentifierString;
}

export interface RequireStepUpInput {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly channel: MFAChannel;
  readonly expectedHash?: string;
}

export type RequireStepUpResult =
  | { readonly status: 'fresh'; readonly satisfiedAt: number }
  | { readonly status: 'challenge_required'; readonly challenge: MFAChallenge };

export interface SubmitStepUpInput {
  readonly challengeId: IdentifierString;
  readonly verify: (challenge: MFAChallenge) => Promise<boolean>;
}

export type SubmitStepUpResult =
  | { readonly status: 'satisfied'; readonly challenge: MFAChallenge }
  | { readonly status: 'rejected'; readonly reason: string };

export interface StepUpService {
  /** Returns `fresh` when MFA happened recently enough, otherwise opens a challenge. */
  require(input: RequireStepUpInput): Promise<RequireStepUpResult>;
  /** Verify a user-submitted response against an open challenge. */
  submit(input: SubmitStepUpInput): Promise<SubmitStepUpResult>;
}

export function createStepUpService(opts: StepUpServiceOptions): StepUpService {
  const now = opts.now ?? Date.now;
  const challengeTTLms = opts.challengeTTLms ?? 5 * 60 * 1000;
  const newId =
    opts.newId ??
    ((): string =>
      `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

  return {
    async require({ userId, tenantId, channel, expectedHash }) {
      const last = await opts.store.lastSatisfiedAt(userId, tenantId);
      const t = now();
      if (last !== null && t - last <= opts.freshnessMs) {
        return { status: 'fresh', satisfiedAt: last };
      }
      const challenge: MFAChallenge = {
        id: newId(),
        userId,
        tenantId,
        channel,
        issuedAt: t,
        expiresAt: t + challengeTTLms,
        ...(expectedHash !== undefined ? { expectedHash } : {}),
      };
      await opts.store.saveChallenge(challenge);
      return { status: 'challenge_required', challenge };
    },

    async submit({ challengeId, verify }) {
      const challenge = await opts.store.getChallenge(challengeId);
      if (!challenge) {
        return { status: 'rejected', reason: 'unknown_challenge' };
      }
      const t = now();
      if (challenge.satisfiedAt) {
        return { status: 'rejected', reason: 'already_satisfied' };
      }
      if (t > challenge.expiresAt) {
        return { status: 'rejected', reason: 'expired' };
      }
      const ok = await verify(challenge);
      if (!ok) {
        return { status: 'rejected', reason: 'verification_failed' };
      }
      await opts.store.markSatisfied(challengeId, t);
      const updated: MFAChallenge = { ...challenge, satisfiedAt: t };
      return { status: 'satisfied', challenge: updated };
    },
  };
}
