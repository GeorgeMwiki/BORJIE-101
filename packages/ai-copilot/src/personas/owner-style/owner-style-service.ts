/**
 * Owner-Style Service — public façade for the rest of the Brain.
 *
 *   getProfile(tenantId)
 *   refine(tenantId, observations)   <- called post-turn by the orchestrator
 *   getStyleHint(tenantId)           <- folded into the next turn's prompt
 *   applyFeedback(tenantId, signal)
 *   applyFeedbackText(tenantId, text)
 *   bootstrap(tenantId, turns)
 *
 * Profile lookups are tenant-scoped: the tenantId is the key. We never
 * co-mingle owners; the store enforces RLS at the DB.
 *
 * Honest-degrade (CLAUDE.md): when the store is unavailable the service
 * computes against an in-memory default and logs at debug — it NEVER throws
 * out of `refine`, so a missing `owner_style_profiles` table can't break a
 * turn, and it NEVER fabricates a learned profile (the returned profile is the
 * neutral default whose confidence sits at the floor).
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import { makeDefaultProfile, type OwnerStyleProfile } from './style-dimensions.js';
import {
  ChatTurnObservationSchema,
  updateProfileBatch,
  type ChatTurnObservation,
} from './profiler.js';
import { inferInitialProfile, type StyleClassifier } from './style-inferrer.js';
import {
  applyFeedback,
  applyFeedbackText,
  parseFeedbackText,
  type FeedbackSignal,
} from './feedback-loop.js';
import { buildStyleHint } from './style-hint.js';
import {
  createInMemoryProfileStore,
  fetchOrDefault,
  type OwnerStyleProfileStore,
} from './persistence-port.js';

const TenantKeySchema = z.string().min(1);

/** Result of a post-turn refine — shape consumed by the orchestrator seam. */
export interface RefineResult {
  readonly profile: OwnerStyleProfile;
  /** Human-readable note of what (if anything) moved, for the trace/event. */
  readonly changeNote: string;
  /** True when the store could not be read/written (ran in-memory only). */
  readonly degraded: boolean;
}

export interface OwnerStyleService {
  getProfile(tenantId: string): Promise<OwnerStyleProfile>;
  refine(
    tenantId: string,
    observations: ReadonlyArray<ChatTurnObservation>
  ): Promise<RefineResult>;
  /** Concise directive folded into the next turn's system prompt (or ''). */
  getStyleHint(tenantId: string): Promise<string>;
  applyFeedback(
    tenantId: string,
    signal: FeedbackSignal
  ): Promise<OwnerStyleProfile>;
  applyFeedbackText(
    tenantId: string,
    text: string
  ): Promise<OwnerStyleProfile>;
  bootstrap(args: {
    readonly tenantId: string;
    readonly turns: ReadonlyArray<ChatTurnObservation>;
    readonly classifier?: StyleClassifier;
  }): Promise<OwnerStyleProfile>;
}

export interface CreateOwnerStyleServiceOptions {
  readonly store?: OwnerStyleProfileStore;
  readonly now?: () => string;
}

function summariseChange(
  prior: OwnerStyleProfile,
  next: OwnerStyleProfile
): string {
  const moved: string[] = [];
  for (const key of [
    'verbosity',
    'detail',
    'language',
    'formality',
    'posture',
  ] as const) {
    if (prior[key].value !== next[key].value) {
      moved.push(`${key}: ${prior[key].value} -> ${next[key].value}`);
    }
  }
  if (moved.length === 0) return 'no headline change';
  return moved.join('; ');
}

export function createOwnerStyleService(
  options: CreateOwnerStyleServiceOptions = {}
): OwnerStyleService {
  const store = options.store ?? createInMemoryProfileStore();
  const now = options.now ?? (() => new Date().toISOString());

  async function loadOrDefault(tenantId: string): Promise<OwnerStyleProfile> {
    return fetchOrDefault(store, { tenantId });
  }

  return {
    async getProfile(tenantId) {
      const t = TenantKeySchema.parse(tenantId);
      return loadOrDefault(t);
    },

    async refine(tenantId, observations) {
      const parsedTenant = TenantKeySchema.safeParse(tenantId);
      if (!parsedTenant.success) {
        // No valid tenant — return a neutral default, never throw.
        return {
          profile: makeDefaultProfile({ tenantId: String(tenantId), now }),
          changeNote: 'skipped: invalid tenant',
          degraded: true,
        };
      }
      const t = parsedTenant.data;

      // Validate observations defensively; skip the rest on a bad shape.
      const turns: ChatTurnObservation[] = [];
      for (const o of observations) {
        const p = ChatTurnObservationSchema.safeParse(o);
        if (p.success) turns.push(p.data);
      }

      let prior: OwnerStyleProfile;
      let degraded = false;
      try {
        prior = await loadOrDefault(t);
      } catch (err) {
        // Honest-degrade: persistence unavailable -> in-memory default.
        logger.debug('owner-style.refine.fetch-degraded', {
          tenantId: t,
          error: err instanceof Error ? err.message : String(err),
        });
        prior = makeDefaultProfile({ tenantId: t, now });
        degraded = true;
      }

      if (turns.length === 0) {
        return { profile: prior, changeNote: 'no observations', degraded };
      }

      // Fold ambient turn evidence, then layer any explicit feedback signal
      // detected in the latest turn (stronger reaction-boost).
      let next = updateProfileBatch(prior, turns, { now });
      const latest = turns[turns.length - 1];
      if (latest) {
        const sig = parseFeedbackText(latest.text);
        if (sig) next = applyFeedback(next, sig, { now });
      }

      try {
        const saved = await store.upsert(next);
        return { profile: saved, changeNote: summariseChange(prior, saved), degraded };
      } catch (err) {
        // Honest-degrade: upsert failed -> return the in-memory result, log,
        // never throw out of a turn.
        logger.debug('owner-style.refine.upsert-degraded', {
          tenantId: t,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          profile: next,
          changeNote: summariseChange(prior, next),
          degraded: true,
        };
      }
    },

    async getStyleHint(tenantId) {
      const t = TenantKeySchema.safeParse(tenantId);
      if (!t.success) return '';
      try {
        const profile = await loadOrDefault(t.data);
        return buildStyleHint(profile);
      } catch (err) {
        logger.debug('owner-style.hint.degraded', {
          tenantId: t.data,
          error: err instanceof Error ? err.message : String(err),
        });
        return '';
      }
    },

    async applyFeedback(tenantId, signal) {
      const t = TenantKeySchema.parse(tenantId);
      const prior = await loadOrDefault(t);
      const next = applyFeedback(prior, signal, { now });
      try {
        return await store.upsert(next);
      } catch (err) {
        logger.debug('owner-style.feedback.upsert-degraded', {
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      }
    },

    async applyFeedbackText(tenantId, text) {
      const t = TenantKeySchema.parse(tenantId);
      const prior = await loadOrDefault(t);
      const next = applyFeedbackText(prior, text, { now });
      if (next === prior) return prior;
      try {
        return await store.upsert(next);
      } catch (err) {
        logger.debug('owner-style.feedback-text.upsert-degraded', {
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      }
    },

    async bootstrap(args) {
      const t = TenantKeySchema.parse(args.tenantId);
      const inferArgs: {
        tenantId: string;
        turns: ReadonlyArray<ChatTurnObservation>;
        classifier?: StyleClassifier;
        now?: () => string;
      } = { tenantId: t, turns: args.turns, now };
      if (args.classifier) inferArgs.classifier = args.classifier;
      const profile = await inferInitialProfile(inferArgs);
      try {
        return await store.upsert(profile);
      } catch (err) {
        logger.debug('owner-style.bootstrap.upsert-degraded', {
          error: err instanceof Error ? err.message : String(err),
        });
        return profile;
      }
    },
  };
}

/** Convenience: build a neutral default for a known tenant. */
export function defaultProfileFor(tenantId: string): OwnerStyleProfile {
  return makeDefaultProfile({ tenantId: TenantKeySchema.parse(tenantId) });
}
