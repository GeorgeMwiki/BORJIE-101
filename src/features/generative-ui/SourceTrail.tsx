"use client";

/**
 * Source trail chrome — shown under every generative-UI spec when
 * `spec.source` is set. Surfaces tier badge, generated-at timestamp, and
 * a stable hash that ties the rendered output back to the decision trace.
 */

import { z } from "zod";
import type { TierBadgeSchema } from "@/core/brain/generative-ui/types";

type Tier = z.infer<typeof TierBadgeSchema>;

interface SourceTrailProps {
  generatedAt?: string;
  sourceQueryHash?: string;
  ttlSeconds?: number;
  tier?: Tier;
}

const TIER_LABEL: Record<Tier, string> = {
  sandbox: "Sandbox",
  supervised: "Supervised",
  "carboni-admin": "Carboni Admin",
  "borjie-admin": "Borjie Admin",
  sovereign: "Sovereign",
};

export function SourceTrail(props: SourceTrailProps) {
  const { generatedAt, sourceQueryHash, ttlSeconds, tier } = props;
  if (!generatedAt && !sourceQueryHash && !ttlSeconds && !tier) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
      {tier ? (
        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
          {TIER_LABEL[tier]}
        </span>
      ) : null}
      {generatedAt ? <span>generated: {generatedAt}</span> : null}
      {ttlSeconds ? <span>ttl: {ttlSeconds}s</span> : null}
      {sourceQueryHash ? (
        <span className="font-mono">hash: {sourceQueryHash.slice(0, 10)}</span>
      ) : null}
    </div>
  );
}
