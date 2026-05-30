/**
 * Owner-Style Service — public façade for the rest of the MD platform.
 *
 *   getProfile(args)
 *   updateFromTurn(args)
 *   adaptPrompt(prompt, args)
 *   styleOutput(response, args)
 *   applyFeedback(args)
 *   bootstrap(args)
 *
 * Profile lookups are tier-scoped: the (tenantId, ownerUserId) pair is the
 * key. We never co-mingle owners. The store enforces RLS at the DB.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { makeDefaultProfile, type OwnerStyleProfile } from "./style-dimensions";
import { type ChatTurnObservation, updateProfile } from "./profiler";
import { inferInitialProfile, type StyleClassifier } from "./style-inferrer";
import {
  adaptPrompt,
  type AdaptedPrompt,
  type BasePrompt,
} from "./prompt-adapter";
import { styleOutput, type StyledOutput } from "./output-styler";
import {
  applyFeedback,
  applyFeedbackText,
  type FeedbackSignal,
} from "./feedback-loop";
import {
  createInMemoryProfileStore,
  fetchOrDefault,
  type ProfileStore,
} from "./style-persistence";

const log = createLogger("md.owner-style");

const OwnerKeySchema = z.object({
  tenantId: z.string().min(1),
  ownerUserId: z.string().min(1),
});
export type OwnerKey = z.infer<typeof OwnerKeySchema>;

export interface OwnerStyleService {
  getProfile(args: OwnerKey): Promise<OwnerStyleProfile>;
  updateFromTurn(args: {
    readonly owner: OwnerKey;
    readonly turn: ChatTurnObservation;
  }): Promise<OwnerStyleProfile>;
  adaptPrompt(args: {
    readonly owner: OwnerKey;
    readonly prompt: BasePrompt;
  }): Promise<AdaptedPrompt>;
  styleOutput(args: {
    readonly owner: OwnerKey;
    readonly response: string;
  }): Promise<StyledOutput>;
  applyFeedback(args: {
    readonly owner: OwnerKey;
    readonly signal: FeedbackSignal;
  }): Promise<OwnerStyleProfile>;
  applyFeedbackText(args: {
    readonly owner: OwnerKey;
    readonly text: string;
  }): Promise<OwnerStyleProfile>;
  bootstrap(args: {
    readonly owner: OwnerKey;
    readonly turns: ReadonlyArray<ChatTurnObservation>;
    readonly classifier?: StyleClassifier;
  }): Promise<OwnerStyleProfile>;
}

export interface CreateServiceOptions {
  readonly store?: ProfileStore;
  readonly now?: () => string;
}

export function createOwnerStyleService(
  options: CreateServiceOptions = {},
): OwnerStyleService {
  const store = options.store ?? createInMemoryProfileStore();
  const now = options.now ?? (() => new Date().toISOString());

  async function loadOrDefault(owner: OwnerKey): Promise<OwnerStyleProfile> {
    const k = OwnerKeySchema.parse(owner);
    return fetchOrDefault(store, k);
  }

  return {
    async getProfile(args) {
      return loadOrDefault(args);
    },

    async updateFromTurn(args) {
      const prior = await loadOrDefault(args.owner);
      const next = updateProfile(prior, args.turn, { now });
      try {
        return await store.upsert(next);
      } catch (err) {
        log.error("upsert failed; returning in-memory result", {
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      }
    },

    async adaptPrompt(args) {
      const profile = await loadOrDefault(args.owner);
      return adaptPrompt(args.prompt, profile);
    },

    async styleOutput(args) {
      const profile = await loadOrDefault(args.owner);
      return styleOutput(args.response, profile);
    },

    async applyFeedback(args) {
      const prior = await loadOrDefault(args.owner);
      const next = applyFeedback(prior, args.signal, { now });
      try {
        return await store.upsert(next);
      } catch (err) {
        log.error("upsert failed after feedback", {
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      }
    },

    async applyFeedbackText(args) {
      const prior = await loadOrDefault(args.owner);
      const next = applyFeedbackText(prior, args.text, { now });
      if (next === prior) return prior;
      try {
        return await store.upsert(next);
      } catch (err) {
        log.error("upsert failed after feedback-text", {
          error: err instanceof Error ? err.message : String(err),
        });
        return next;
      }
    },

    async bootstrap(args) {
      const k = OwnerKeySchema.parse(args.owner);
      const profile = await inferInitialProfile({
        tenantId: k.tenantId,
        ownerUserId: k.ownerUserId,
        turns: args.turns,
        classifier: args.classifier,
        now,
      });
      try {
        return await store.upsert(profile);
      } catch (err) {
        log.error("upsert failed during bootstrap", {
          error: err instanceof Error ? err.message : String(err),
        });
        return profile;
      }
    },
  };
}

/** Convenience: build a profile-less default for a known owner. */
export function defaultProfileFor(owner: OwnerKey): OwnerStyleProfile {
  const k = OwnerKeySchema.parse(owner);
  return makeDefaultProfile(k);
}
