/**
 * Unleash adapter — second open-source flag provider. Used by teams
 * that self-host. Same port; no SDK dep — direct REST.
 *
 * Endpoint (GET /api/client/features) returns:
 *   { features: [{ name, enabled, strategies: [{ name, parameters }] }] }
 *
 * We support the two strategies live test cares about:
 *   - `default`: pure enabled/disabled
 *   - `gradualRolloutUserId`: % rollout, sticky on userId
 */

import type { FeatureFlagsPort, Flag, FlagContext } from "./types.js";

export interface UnleashAdapterConfig {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly fetchFn?: typeof fetch;
}

interface UnleashStrategy {
  readonly name: string;
  readonly parameters?: Readonly<Record<string, string>>;
}

interface UnleashFeature {
  readonly name: string;
  readonly enabled: boolean;
  readonly variant?: string;
  readonly strategies?: readonly UnleashStrategy[];
}

interface UnleashFeaturesResponse {
  readonly features: readonly UnleashFeature[];
}

export function createUnleashAdapter(
  config: UnleashAdapterConfig
): FeatureFlagsPort {
  const fetchFn = config.fetchFn ?? fetch;

  async function load(): Promise<UnleashFeaturesResponse> {
    const url = `${config.endpoint.replace(/\/$/, "")}/api/client/features`;
    const res = await fetchFn(url, {
      headers: { Authorization: config.apiKey },
    });
    if (!res.ok) {
      throw new Error(`Unleash fetch failed: ${res.status}`);
    }
    return (await res.json()) as UnleashFeaturesResponse;
  }

  function evaluate(
    feature: UnleashFeature | undefined,
    context: FlagContext
  ): boolean {
    if (!feature) return false;
    if (!feature.enabled) return false;
    if (!feature.strategies || feature.strategies.length === 0) return true;
    for (const strategy of feature.strategies) {
      if (strategy.name === "default") return true;
      if (strategy.name === "gradualRolloutUserId") {
        const pct = Number(strategy.parameters?.percentage ?? "0");
        const bucket = stickyBucket(feature.name, context);
        if (bucket < pct) return true;
      }
    }
    return false;
  }

  return {
    async isEnabled(flag: string, context: FlagContext): Promise<boolean> {
      const data = await load();
      const f = data.features.find((x) => x.name === flag);
      return evaluate(f, context);
    },

    async getVariant(flag: string, context: FlagContext): Promise<string> {
      const data = await load();
      const f = data.features.find((x) => x.name === flag);
      const enabled = evaluate(f, context);
      if (!enabled) return "control";
      return f?.variant ?? "treatment";
    },

    async getAllFlags(_tenantId: string): Promise<readonly Flag[]> {
      const data = await load();
      return data.features.map((f): Flag => {
        return f.variant
          ? { key: f.name, enabled: f.enabled, variant: f.variant }
          : { key: f.name, enabled: f.enabled };
      });
    },
  };
}

function stickyBucket(flag: string, context: FlagContext): number {
  const key = `${flag}:${context.userId ?? context.tenantId}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
