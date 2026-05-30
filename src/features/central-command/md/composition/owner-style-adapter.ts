/**
 * Owner-style adapter — `OwnerStyleService` ➜ `MdOwnerStylePort`.
 *
 * The orchestrator's port speaks in `(ownerId: string)`. The underlying
 * `OwnerStyleService` needs an `OwnerKey { tenantId, ownerUserId }` to
 * stay tier-scoped under RLS. The adapter closes over the request's
 * tenantId and builds the key per call.
 *
 * It also reshapes the underlying `OwnerStyleProfile` into the simpler
 * `MdOwnerStyleProfile` the orchestrator consumes — collapsing the
 * verbose per-dimension breakdown into a single `posture`, surfacing
 * the strongest tone preferences, and aggregating dimension confidences
 * into one number.
 *
 * @module features/central-command/md/composition/owner-style-adapter
 */

import type {
  MdOwnerStylePort,
  MdOwnerStyleProfile,
  MdOwnerStyleObservation,
} from "@/features/central-command/md/core/contracts";
import type {
  OwnerStyleService,
  OwnerKey,
} from "@/features/central-command/md/owner-style/owner-style-service";
import type { OwnerStyleProfile } from "@/features/central-command/md/owner-style/style-dimensions";

import type { RequestContext } from "./request-context";

export interface OwnerStyleAdapterDeps {
  readonly service: OwnerStyleService;
  readonly ctx: RequestContext;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

const POSTURE_BY_DECISION_STYLE: Record<
  string,
  MdOwnerStyleProfile["posture"]
> = {
  directive: "bias-to-action",
  consultative: "deliberate",
  "data-driven": "data-driven",
  collaborative: "people-first",
};

function projectProfile(
  ownerId: string,
  profile: OwnerStyleProfile,
): MdOwnerStyleProfile {
  const posture =
    POSTURE_BY_DECISION_STYLE[profile.decisionStyle.value] ?? "deliberate";

  const tonePrefs: ReadonlyArray<string> = [
    profile.tone.value,
    profile.verbosity.value,
    profile.languagePreference.value,
  ];

  const updatedAtMs = Date.parse(profile.lastUpdatedAt);

  return Object.freeze({
    ownerId,
    posture,
    confidence: Math.max(0, Math.min(1, profile.confidence)),
    tonePrefs: Object.freeze(tonePrefs),
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
  });
}

export function createOwnerStyleAdapter(
  deps: OwnerStyleAdapterDeps,
): MdOwnerStylePort {
  const { service, ctx, logger } = deps;

  function keyFor(ownerId: string): OwnerKey {
    return { tenantId: ctx.tenantId, ownerUserId: ownerId };
  }

  return Object.freeze({
    async getProfile(ownerId: string): Promise<MdOwnerStyleProfile | null> {
      logger?.debug("ownerStyle.getProfile", {
        correlationId: ctx.correlationId,
        ownerId,
      });
      const profile = await service.getProfile(keyFor(ownerId));
      return projectProfile(ownerId, profile);
    },

    async refine(
      ownerId: string,
      observations: ReadonlyArray<MdOwnerStyleObservation>,
    ): Promise<{
      readonly profile: MdOwnerStyleProfile;
      readonly changeNote: string;
    }> {
      logger?.debug("ownerStyle.refine", {
        correlationId: ctx.correlationId,
        ownerId,
        observations: observations.length,
      });
      let lastProfile: OwnerStyleProfile | null = null;
      for (const obs of observations) {
        lastProfile = await service.updateFromTurn({
          owner: keyFor(ownerId),
          turn: {
            text: obs.text,
            timestamp: new Date(obs.tsMs).toISOString(),
          },
        });
      }
      if (!lastProfile) {
        // No observations: just read the current profile.
        lastProfile = await service.getProfile(keyFor(ownerId));
      }
      const changeNote = `refined from ${observations.length} observation${
        observations.length === 1 ? "" : "s"
      }`;
      return Object.freeze({
        profile: projectProfile(ownerId, lastProfile),
        changeNote,
      });
    },
  });
}
