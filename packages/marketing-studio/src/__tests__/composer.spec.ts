/**
 * Layer-2 orchestrator tests — composeCampaign(recipe, ctx).
 */

import { describe, it, expect } from 'vitest';
import { composeCampaign } from '../composer.js';
import { buyerAcquisitionRecipe } from '../recipes/buyer-acquisition.js';
import { regulatoryTransparencyRecipe } from '../recipes/regulatory-transparency.js';
import { investorAnnouncementRecipe } from '../recipes/investor-announcement.js';
import type {
  CampaignComposeContext,
  CampaignRecipe,
  SpanCitation,
} from '../types.js';
import { MarketingError } from '../types.js';

const CITATIONS: ReadonlyArray<SpanCitation> = Object.freeze([
  Object.freeze({
    id: 'assay-001',
    claim: 'assay',
    source: { kind: 'assay_cert' as const, ref: 'cert-1' },
  }),
  Object.freeze({
    id: 'bot-2025-q3',
    claim: 'BoT',
    source: { kind: 'research_result' as const, ref: 'bot-q3' },
  }),
  Object.freeze({
    id: 'audit-q3',
    claim: 'Audit',
    source: { kind: 'ledger' as const, ref: 'audit-q3' },
  }),
  Object.freeze({
    id: 'tumemadini-q3',
    claim: 'Tum',
    source: { kind: 'statute' as const, ref: 'tum-q3' },
  }),
]);

const BASE_CTX: CampaignComposeContext = Object.freeze({
  tenant_id: 't1',
  intent_payload: { kind: 'buyer_outreach' },
  owner_profile: Object.freeze({
    id: 'u1',
    displayName: 'Mr. Mwikila',
    preferred_language: 'en' as const,
  }),
  audience_segment: 'mineral_buyer' as const,
  language: 'en' as const,
  citations: CITATIONS,
  generated_at: '2026-01-01T00:00:00.000Z',
});

describe('composeCampaign', () => {
  it('produces a CampaignArtifact for buyer_acquisition recipe', async () => {
    const recipe: CampaignRecipe = buyerAcquisitionRecipe;
    const result = await composeCampaign(recipe, BASE_CTX);
    expect(result.artifact.assets.length).toBeGreaterThan(0);
    expect(result.compliance_passes.every((p) => p.scan_passed)).toBe(true);
  });

  it('produces a CampaignArtifact for regulatory_transparency recipe', async () => {
    const ctx = { ...BASE_CTX, audience_segment: 'regulator' as const };
    const result = await composeCampaign(regulatoryTransparencyRecipe, ctx);
    expect(result.artifact.assets.length).toBeGreaterThan(0);
  });

  it('produces a CampaignArtifact for investor_announcement recipe', async () => {
    const ctx = { ...BASE_CTX, audience_segment: 'institutional_investor' as const };
    const result = await composeCampaign(investorAnnouncementRecipe, ctx);
    expect(result.artifact.assets.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses composition when an asset fails compliance', async () => {
    const recipe: CampaignRecipe = {
      ...buyerAcquisitionRecipe,
      compliance: {
        ...buyerAcquisitionRecipe.compliance,
        required_disclaimers: ['THIS DISCLAIMER WILL NOT BE PRESENT'],
      },
    };
    await expect(composeCampaign(recipe, BASE_CTX)).rejects.toThrow(MarketingError);
  });
});
