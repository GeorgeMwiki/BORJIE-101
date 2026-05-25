/**
 * GrowthBook adapter. LITFIN uses GrowthBook; this is the parity bridge.
 *
 * The adapter is constructed against the public REST API rather than
 * the GrowthBook SDK directly so this package has zero runtime deps —
 * each consumer keeps their own SDK version pinned if they want full
 * client-side features.
 *
 * Request shape (GET /api/features/{tenantId}):
 *   { features: Record<string, { defaultValue: boolean, rules?: [...] }> }
 *
 * Errors are caught by the composition wrapper in `feature-flags.ts`,
 * which then falls back to the configured default.
 */

import type { FeatureFlagsPort, Flag, FlagContext } from "./types.js";

export interface GrowthBookAdapterConfig {
  readonly apiKey: string;
  /** Defaults to GrowthBook cloud. Self-hosted? Override. */
  readonly endpoint?: string;
  /** Bring-your-own fetch — for tests. Defaults to global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

interface GrowthBookFeature {
  readonly defaultValue?: unknown;
  readonly rules?: ReadonlyArray<{
    readonly condition?: Readonly<Record<string, unknown>>;
    readonly force?: unknown;
    readonly coverage?: number;
  }>;
}

interface GrowthBookFeaturesResponse {
  readonly features: Readonly<Record<string, GrowthBookFeature>>;
}

export function createGrowthBookAdapter(
  config: GrowthBookAdapterConfig
): FeatureFlagsPort {
  const endpoint = config.endpoint ?? "https://api.growthbook.io";
  const fetchFn = config.fetchFn ?? fetch;

  async function load(tenantId: string): Promise<GrowthBookFeaturesResponse> {
    const url = `${endpoint}/api/features/${encodeURIComponent(tenantId)}`;
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`GrowthBook fetch ${tenantId} failed: ${res.status}`);
    }
    return (await res.json()) as GrowthBookFeaturesResponse;
  }

  function evaluate(
    feature: GrowthBookFeature | undefined,
    context: FlagContext
  ): { enabled: boolean; variant: string } {
    if (!feature) return { enabled: false, variant: "control" };
    const def = feature.defaultValue;
    let enabled = toBoolean(def);
    let variant = toVariant(def);
    if (feature.rules) {
      for (const rule of feature.rules) {
        if (matchesCondition(rule.condition, context)) {
          if (typeof rule.coverage === "number") {
            const bucket = stickyBucket(context);
            if (bucket >= rule.coverage * 100) continue;
          }
          enabled = toBoolean(rule.force ?? true);
          variant = toVariant(rule.force ?? variant);
        }
      }
    }
    return { enabled, variant };
  }

  return {
    async isEnabled(flag: string, context: FlagContext): Promise<boolean> {
      const data = await load(context.tenantId);
      return evaluate(data.features[flag], context).enabled;
    },

    async getVariant(flag: string, context: FlagContext): Promise<string> {
      const data = await load(context.tenantId);
      return evaluate(data.features[flag], context).variant;
    },

    async getAllFlags(tenantId: string): Promise<readonly Flag[]> {
      const data = await load(tenantId);
      const out: Flag[] = [];
      for (const [key, feature] of Object.entries(data.features)) {
        const enabled = toBoolean(feature.defaultValue);
        const variant = toVariant(feature.defaultValue);
        const flagObj: Flag =
          variant === "control"
            ? { key, enabled }
            : { key, enabled, variant };
        out.push(flagObj);
      }
      return out;
    },
  };
}

function toBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v !== "" && v !== "control" && v !== "off";
  return Boolean(v);
}

function toVariant(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "treatment" : "control";
  return "control";
}

function matchesCondition(
  cond: Readonly<Record<string, unknown>> | undefined,
  context: FlagContext
): boolean {
  if (!cond) return true;
  const attrs: Record<string, unknown> = {
    tenantId: context.tenantId,
    userId: context.userId ?? "",
    ...(context.attributes ?? {}),
  };
  for (const [k, expected] of Object.entries(cond)) {
    if (attrs[k] !== expected) return false;
  }
  return true;
}

function stickyBucket(context: FlagContext): number {
  const key = `${context.tenantId}:${context.userId ?? "_"}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
