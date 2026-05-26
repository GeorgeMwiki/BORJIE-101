/**
 * Layer-2 orchestrator — `composeCampaign(recipe, ctx)`.
 *
 * Walks the recipe's asset list and delegates each asset to its
 * sub-composer. After composition, every asset is fed through the
 * compliance gate (Layer 3). Failures abort with a structured
 * MarketingError(COMPLIANCE_REFUSED).
 */

import type {
  CampaignArtifact,
  CampaignComposeContext,
  CampaignRecipe,
  ComposedAsset,
} from './types.js';
import { MarketingError } from './types.js';
import { runComplianceScan } from './compliance/index.js';

export interface ComposeOutcome {
  readonly artifact: CampaignArtifact;
  readonly compliance_passes: ReadonlyArray<{
    readonly asset_id: string;
    readonly scan_passed: boolean;
  }>;
}

/**
 * Compose a campaign via its recipe. Returns the artifact plus an
 * array of compliance pass markers. When any asset fails compliance,
 * throws MarketingError(COMPLIANCE_REFUSED) — the artifact is NOT
 * partially-returned, matching the document-templates spec.
 */
export async function composeCampaign(
  recipe: CampaignRecipe,
  ctx: CampaignComposeContext,
): Promise<ComposeOutcome> {
  const artifact = await recipe.compose(ctx);

  const passes: Array<{ readonly asset_id: string; readonly scan_passed: boolean }> = [];
  const failures: Array<{ readonly asset: ComposedAsset; readonly detail: string }> = [];

  for (const asset of artifact.assets) {
    const scan = runComplianceScan({
      asset,
      compliance: recipe.compliance,
    });
    passes.push({ asset_id: asset.id, scan_passed: scan.scan_passed });
    if (!scan.scan_passed) {
      const detail = JSON.stringify({
        uncited_claims: scan.uncited_claims.length,
        forbidden: scan.forbidden_phrases_found,
        missing_disclaimers: scan.missing_disclaimers,
        geo_flags: scan.geo_restriction_flags,
      });
      failures.push({ asset, detail });
    }
  }

  if (failures.length > 0) {
    throw new MarketingError(
      'COMPLIANCE_REFUSED',
      `${failures.length} asset(s) failed compliance scan`,
      failures.map((f) => `${f.asset.id}:${f.detail}`),
    );
  }

  return Object.freeze({
    artifact,
    compliance_passes: Object.freeze(passes),
  });
}
