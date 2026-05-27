/**
 * Pilot kill-switch — emergency disable for the 3–5 pilot cohort window.
 *
 * Context: the pilot is the highest-stakes, lowest-tolerance window in
 * Borjie's history. A single bad deploy that breaks the workforce-mobile
 * app on-site can sour a relationship that took weeks to build. This
 * switch lets the on-call operator yank the pilot surface in seconds —
 * without touching the platform's other tenants — by flipping a flag
 * (or, in true emergencies, an env var). Once tripped, every gateway
 * request tagged `x-pilot: true` returns a structured 503 with a clear
 * Swahili+English message so the pilot owner understands the pause is
 * intentional and temporary.
 *
 * Default state — **OFF (pilot disabled)**. The switch is closed by
 * default so an accidental deploy onto a new environment never exposes
 * the pilot endpoints. Operators must explicitly enable the pilot
 * surface by setting `PILOT_ENABLED=true` or seeding a per-tenant flag.
 *
 * Three layers of control (highest precedence first):
 *   1. `PILOT_KILL_SWITCH_OPEN=true`           — emergency disable
 *      (overrides everything; used during incidents).
 *   2. DB-backed feature flag `pilot_enabled`  — per-tenant + cohort
 *      rollout via `FeatureFlagsPort` (the canonical knob).
 *   3. `PILOT_ENABLED=true` env (default OFF)  — global allow-list when
 *      the DB-backed flag is not configured (e.g. dev/test).
 *
 * Wired into a Hono middleware in `services/api-gateway/src/middleware/
 * pilot-kill-switch.ts`, applied conditionally on routes tagged
 * `x-pilot: true` — never on the global pipeline, so pausing pilots
 * does not break the rest of the platform.
 */

import type { FeatureFlagsPort } from "./types.js";

/** Names of every env var consulted when deciding pilot state. */
export const PILOT_KILL_SWITCH_ENV = "PILOT_KILL_SWITCH_OPEN";
export const PILOT_ENABLED_ENV = "PILOT_ENABLED";

/** Canonical DB-backed feature-flag key for the per-tenant pilot toggle. */
export const PILOT_ENABLED_FLAG = "pilot_enabled";

/**
 * Caller-supplied env source. Tests pass a plain record so they never
 * touch the host `process.env`. Production callers omit this and we
 * read `process.env` directly.
 */
export type PilotEnvSource = Readonly<Record<string, string | undefined>>;

/** Inputs for the {@link isPilotEnabled} predicate. */
export interface PilotEnabledQuery {
  readonly tenantId: string;
  /**
   * Cohort label (e.g. "pilot-tz-may-2026"). Surfaced as a flag attribute
   * so cohort-scoped rollouts can be expressed without bespoke logic.
   */
  readonly cohort?: string;
  /** Optional user id for sticky-bucket rollouts within a tenant. */
  readonly userId?: string;
}

/** Composition deps for the predicate. */
export interface PilotKillSwitchDeps {
  /** Optional feature-flag adapter; when absent we fall back to env vars. */
  readonly featureFlags?: FeatureFlagsPort;
  /** Optional env source override; defaults to `process.env`. */
  readonly env?: PilotEnvSource;
}

function readEnv(source: PilotEnvSource | undefined, name: string): string | undefined {
  if (source !== undefined) {
    const value = source[name];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  }
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isTruthyFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

/**
 * True when the pilot kill-switch has been tripped (emergency disable).
 * When this returns TRUE, every pilot route MUST respond 503 regardless
 * of feature-flag state.
 */
export function isPilotKillSwitchOpen(env?: PilotEnvSource): boolean {
  return isTruthyFlag(readEnv(env, PILOT_KILL_SWITCH_ENV));
}

/**
 * True when the global `PILOT_ENABLED` env opt-in is set. Used as a
 * fallback when no DB-backed flag adapter is configured.
 *
 * Default behaviour: **FALSE** — pilots are OFF unless explicitly
 * enabled. This guards against accidental deploys onto an environment
 * that has not been provisioned for the cohort.
 */
export function isPilotEnvOptIn(env?: PilotEnvSource): boolean {
  return isTruthyFlag(readEnv(env, PILOT_ENABLED_ENV));
}

/**
 * Resolves whether the pilot is enabled for a given tenant/cohort.
 *
 * Order of precedence:
 *   1. `PILOT_KILL_SWITCH_OPEN=true`           → ALWAYS false
 *   2. DB-backed feature flag `pilot_enabled`  → adapter answer
 *   3. `PILOT_ENABLED=true` env (dev/test)     → true
 *   4. Default                                 → false
 */
export async function isPilotEnabled(
  query: PilotEnabledQuery,
  deps: PilotKillSwitchDeps = {},
): Promise<boolean> {
  if (isPilotKillSwitchOpen(deps.env)) {
    return false;
  }

  if (deps.featureFlags) {
    const attributes: Record<string, string> = {};
    if (query.cohort) {
      attributes.cohort = query.cohort;
    }
    const flagged = await deps.featureFlags.isEnabled(PILOT_ENABLED_FLAG, {
      tenantId: query.tenantId,
      ...(query.userId !== undefined ? { userId: query.userId } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    });
    if (flagged) {
      return true;
    }
  }

  return isPilotEnvOptIn(deps.env);
}

/**
 * Bilingual (sw/en) response body returned by the pilot kill-switch
 * gateway middleware when the switch is tripped. Centralised here so the
 * middleware, the workforce-mobile pause banner, and the runbook share
 * one canonical wording.
 */
export const PILOT_KILL_SWITCH_RESPONSE = Object.freeze({
  success: false,
  error: Object.freeze({
    code: "PILOT_PAUSED",
    message_sw:
      "Mfumo wa majaribio umesitishwa kwa muda na timu ya Borjie. " +
      "Tafadhali subiri na ujaribu tena baadaye au wasiliana na mwakilishi wako.",
    message_en:
      "The pilot surface has been temporarily paused by the Borjie team. " +
      "Please wait and retry shortly, or contact your Borjie liaison.",
  }),
});

export type PilotKillSwitchResponse = typeof PILOT_KILL_SWITCH_RESPONSE;
