/**
 * In-memory adapter — for tests and dev. Resolves flags from a
 * static map. No network, no DB.
 */

import type { FeatureFlagsPort, Flag, FlagContext } from "./types.js";

export interface InMemoryFlagDefinition {
  readonly enabled: boolean;
  readonly variant?: string;
  /** Tenants explicitly allowed. If set, flag is OFF for everyone else. */
  readonly allowedTenants?: readonly string[];
  /** % rollout 0..100; uses sticky bucket by `${tenantId}:${userId ?? "_"}`. */
  readonly rolloutPercent?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InMemoryAdapterConfig {
  readonly flags: Readonly<Record<string, InMemoryFlagDefinition>>;
}

export function createInMemoryAdapter(
  config: InMemoryAdapterConfig
): FeatureFlagsPort {
  return {
    async isEnabled(flag: string, context: FlagContext): Promise<boolean> {
      const def = config.flags[flag];
      if (!def) return false;
      if (!def.enabled) return false;
      if (def.allowedTenants && !def.allowedTenants.includes(context.tenantId)) {
        return false;
      }
      if (typeof def.rolloutPercent === "number") {
        const bucket = stickyBucket(flag, context);
        if (bucket >= def.rolloutPercent) return false;
      }
      return true;
    },

    async getVariant(flag: string, context: FlagContext): Promise<string> {
      const enabled = await this.isEnabled(flag, context);
      if (!enabled) return "control";
      return config.flags[flag]?.variant ?? "control";
    },

    async getAllFlags(_tenantId: string): Promise<readonly Flag[]> {
      const out: Flag[] = [];
      for (const [key, def] of Object.entries(config.flags)) {
        const flag: Flag = def.metadata
          ? def.variant
            ? {
                key,
                enabled: def.enabled,
                variant: def.variant,
                metadata: def.metadata,
              }
            : { key, enabled: def.enabled, metadata: def.metadata }
          : def.variant
          ? { key, enabled: def.enabled, variant: def.variant }
          : { key, enabled: def.enabled };
        out.push(flag);
      }
      return out;
    },
  };
}

/**
 * Deterministic 0..99 bucket for sticky rollout. Same flag+context
 * always lands in the same bucket so a user never flips between
 * variants on the same session.
 */
function stickyBucket(flag: string, context: FlagContext): number {
  const key = `${flag}:${context.tenantId}:${context.userId ?? "_"}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
