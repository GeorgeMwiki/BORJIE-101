/**
 * Consent management service.
 *
 * Append-only log. Withdrawal is a new record with `granted: false`.
 * Re-consent triggers:
 *   1. Scope change (caller bumps version)
 *   2. Version bump (latest.version < currentVersion)
 *   3. Jurisdiction move (latest.jurisdiction !== current)
 *
 * For minors below the jurisdiction's age of data consent, callers
 * MUST go through `parentalConsent()`, which forces `grantedBy` to be
 * present and validates the verified-adult id with the supplied
 * verifier function.
 *
 * Sources cited inline. No I/O — pluggable `EthicsStore`.
 */

import type {
  ConsentChannel,
  ConsentRecord,
  ConsentScope,
  ConsentStatus,
  EthicsStore,
  Jurisdiction,
} from '../types.js';
import { ageOfDataConsent, needsParentalConsent } from './age-of-consent.js';

export interface ConsentService {
  readonly ageOfDataConsent: (jurisdiction: Jurisdiction) => number;
  readonly needsParentalConsent: (subjectAge: number, jurisdiction: Jurisdiction) => boolean;

  recordConsent(args: {
    subjectId: string;
    scope: ConsentScope;
    version: string;
    channel: ConsentChannel;
    jurisdiction: Jurisdiction;
    reason?: string;
  }): Promise<ConsentRecord>;

  verifyConsent(args: {
    subjectId: string;
    scope: ConsentScope;
    currentVersion: string;
    currentJurisdiction?: Jurisdiction;
  }): Promise<ConsentStatus>;

  withdrawConsent(args: {
    subjectId: string;
    scope: ConsentScope;
    version: string;
    channel: ConsentChannel;
    jurisdiction: Jurisdiction;
    reason: string;
  }): Promise<ConsentRecord>;

  parentalConsent(args: {
    minorSubjectId: string;
    parentSubjectId: string;
    parentAge: number;
    scope: ConsentScope;
    version: string;
    channel: ConsentChannel;
    jurisdiction: Jurisdiction;
    /** Caller's parent-verification check (KYC, signed letter, etc). */
    verifyParent: (parentSubjectId: string) => Promise<boolean> | boolean;
    reason?: string;
  }): Promise<ConsentRecord>;

  history(args: {
    subjectId: string;
    scope: ConsentScope;
  }): Promise<ReadonlyArray<ConsentRecord>>;
}

export interface ConsentServiceDeps {
  readonly store: EthicsStore;
  readonly now?: () => Date;
}

function nowIso(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

/**
 * Build the consent service. Pure factory; dependency on `store` only.
 */
export function createConsentService(deps: ConsentServiceDeps): ConsentService {
  const { store } = deps;

  async function latest(
    subjectId: string,
    scope: ConsentScope,
  ): Promise<ConsentRecord | undefined> {
    const records = await store.consentHistory({ subjectId, scope });
    if (records.length === 0) return undefined;
    return records[records.length - 1];
  }

  return {
    ageOfDataConsent,
    needsParentalConsent,

    async recordConsent(args): Promise<ConsentRecord> {
      const record: ConsentRecord = {
        subjectId: args.subjectId,
        scope: args.scope,
        version: args.version,
        channel: args.channel,
        jurisdiction: args.jurisdiction,
        granted: true,
        recordedAt: nowIso(deps.now),
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      };
      await store.appendConsent(record);
      return record;
    },

    async verifyConsent({
      subjectId,
      scope,
      currentVersion,
      currentJurisdiction,
    }): Promise<ConsentStatus> {
      const last = await latest(subjectId, scope);
      if (!last) {
        return {
          granted: false,
          needsRefresh: true,
          reason: 'no-consent-recorded',
        };
      }
      if (!last.granted) {
        return {
          granted: false,
          needsRefresh: true,
          reason: 'consent-withdrawn',
          latestRecord: last,
        };
      }
      if (last.version !== currentVersion) {
        return {
          granted: false,
          needsRefresh: true,
          reason: 'version-bumped',
          latestRecord: last,
        };
      }
      if (currentJurisdiction !== undefined && last.jurisdiction !== currentJurisdiction) {
        return {
          granted: false,
          needsRefresh: true,
          reason: 'jurisdiction-changed',
          latestRecord: last,
        };
      }
      return {
        granted: true,
        needsRefresh: false,
        latestRecord: last,
      };
    },

    async withdrawConsent(args): Promise<ConsentRecord> {
      const record: ConsentRecord = {
        subjectId: args.subjectId,
        scope: args.scope,
        version: args.version,
        channel: args.channel,
        jurisdiction: args.jurisdiction,
        granted: false,
        recordedAt: nowIso(deps.now),
        reason: args.reason,
      };
      await store.appendConsent(record);
      return record;
    },

    async parentalConsent(args): Promise<ConsentRecord> {
      // Parent themselves must be at/above age of consent.
      if (needsParentalConsent(args.parentAge, args.jurisdiction)) {
        throw new Error(
          `[ethics-framework/consent] parent is below age of data consent for ${args.jurisdiction} (need ${ageOfDataConsent(args.jurisdiction)})`,
        );
      }
      const ok = await args.verifyParent(args.parentSubjectId);
      if (!ok) {
        throw new Error('[ethics-framework/consent] parent verification failed');
      }
      const record: ConsentRecord = {
        subjectId: args.minorSubjectId,
        scope: args.scope,
        version: args.version,
        channel: args.channel,
        jurisdiction: args.jurisdiction,
        granted: true,
        recordedAt: nowIso(deps.now),
        grantedBy: args.parentSubjectId,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      };
      await store.appendConsent(record);
      return record;
    },

    async history({ subjectId, scope }): Promise<ReadonlyArray<ConsentRecord>> {
      return store.consentHistory({ subjectId, scope });
    },
  };
}
