/**
 * Composition root. Wraps an adapter with default-fallback for
 * crash-safety. If the adapter throws, return the configured default.
 *
 * This is the only function call-sites should use — the raw adapters
 * are exported for advanced wiring (e.g. primary + secondary fallback
 * chains) but day-to-day code goes through here.
 */

import type {
  FeatureFlagsConfig,
  FeatureFlagsPort,
  Flag,
  FlagContext,
} from "./types.js";

export function createFeatureFlags(
  config: FeatureFlagsConfig
): FeatureFlagsPort {
  const defaultEnabled = config.defaultEnabled ?? false;
  const defaultVariant = config.defaultVariant ?? "control";

  return {
    async isEnabled(flag: string, context: FlagContext): Promise<boolean> {
      try {
        return await config.adapter.isEnabled(flag, context);
      } catch {
        return defaultEnabled;
      }
    },

    async getVariant(flag: string, context: FlagContext): Promise<string> {
      try {
        return await config.adapter.getVariant(flag, context);
      } catch {
        return defaultVariant;
      }
    },

    async getAllFlags(tenantId: string): Promise<readonly Flag[]> {
      try {
        return await config.adapter.getAllFlags(tenantId);
      } catch {
        return [];
      }
    },
  };
}
