import { describe, expect, it } from 'vitest';
import { buildProposal } from '../proposals/proposal-builder.js';
import { MutationRecipeRegistry } from '../recipes/registry.js';
import type {
  ApprovalRecord,
  MutationProposal,
  MutationRecipe,
  MutationResult,
} from '../types.js';

const NOW = '2026-05-26T10:00:00.000Z';

function fakeRecipe(overrides: Partial<MutationRecipe> = {}): MutationRecipe {
  return {
    id: 'parcel_update',
    class: 'data',
    version: 1,
    status: 'live',
    authority_tier: 1,
    is_critical: false,
    reversibility: 'fully',
    required_citations: [],
    brand: 'borjie',
    async compose(ctx): Promise<MutationProposal> {
      return {
        id: '',
        recipe_id: 'parcel_update',
        recipe_version: 1,
        tenant_id: ctx.tenantId,
        proposed_by: ctx.proposedBy,
        proposed_at: ctx.nowIso,
        subject: ctx.subject,
        preview: {
          summary: 'updating parcel grade',
          current: { grade: 'A' },
          proposed: { grade: 'B' },
        },
        research_evidence_ids: ['assay-123'],
        cost_or_value_at_stake_usd_cents: 0,
        reversibility: 'fully',
        authority_tier: 1,
        requires_double_verify: false,
        expires_at: '',
        audit_hash: '',
      };
    },
    async execute(_p, _a): Promise<MutationResult> {
      throw new Error('not exercised in this test');
    },
    ...overrides,
  };
}

describe('buildProposal', () => {
  it('stamps tier-1 expiry to 24h after now', async () => {
    const recipe = fakeRecipe();
    const { proposal } = await buildProposal({
      recipe,
      context: {
        tenantId: 'tenant-1',
        subject: { kind: 'parcel', id: 'p-1' },
        proposedBy: 'mr_mwikila',
        researchEvidenceIds: [],
        nowIso: NOW,
      },
      uuid: () => 'fixed-uuid',
    });
    const expiryMs = Date.parse(proposal.expires_at) - Date.parse(NOW);
    expect(expiryMs).toBe(24 * 60 * 60 * 1000);
    expect(proposal.id).toBe('fixed-uuid');
    expect(proposal.audit_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.requires_double_verify).toBe(false);
  });

  it('trips double-verify when funds exceed threshold on a Tier 2', async () => {
    const recipe = fakeRecipe({
      id: 'fx_hedge_record',
      authority_tier: 2,
      is_critical: false,
      reversibility: 'partial',
      async compose(ctx) {
        return {
          id: '',
          recipe_id: 'fx_hedge_record',
          recipe_version: 1,
          tenant_id: ctx.tenantId,
          proposed_by: ctx.proposedBy,
          proposed_at: ctx.nowIso,
          subject: ctx.subject,
          preview: {
            summary: 'open hedge',
            current: null,
            proposed: { lot: 1000 },
          },
          research_evidence_ids: ['fx-window-1'],
          cost_or_value_at_stake_usd_cents: 10_000_000_00,
          reversibility: 'partial',
          authority_tier: 2,
          requires_double_verify: false,
          expires_at: '',
          audit_hash: '',
        };
      },
    });
    const { proposal, tripped } = await buildProposal({
      recipe,
      context: {
        tenantId: 'tenant-1',
        subject: { kind: 'fx_position', id: 'fx-1' },
        proposedBy: 'mr_mwikila',
        researchEvidenceIds: ['fx-window-1'],
        nowIso: NOW,
      },
      uuid: () => 'uuid-2',
    });
    expect(tripped).toContain('funds_threshold');
    expect(proposal.requires_double_verify).toBe(true);
    // Tier-2-critical expiry → 14d
    const expiryMs = Date.parse(proposal.expires_at) - Date.parse(NOW);
    expect(expiryMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('trips bulk_delete when affectedRowCount > 100', async () => {
    const recipe = fakeRecipe({
      id: 'bulk_delete',
      class: 'data',
      authority_tier: 2,
      is_critical: false,
      reversibility: 'irreversible',
      async compose(ctx) {
        return {
          id: '',
          recipe_id: 'bulk_delete',
          recipe_version: 1,
          tenant_id: ctx.tenantId,
          proposed_by: ctx.proposedBy,
          proposed_at: ctx.nowIso,
          subject: { kind: 'bulk_delete', id: 'incidents' },
          preview: {
            summary: 'wipe 250 historical incidents',
            current: { rows: 250 },
            proposed: { rows: 0 },
          },
          research_evidence_ids: ['retention-policy'],
          cost_or_value_at_stake_usd_cents: 0,
          reversibility: 'irreversible',
          authority_tier: 2,
          requires_double_verify: false,
          expires_at: '',
          audit_hash: '',
        };
      },
    });
    const { tripped } = await buildProposal({
      recipe,
      context: {
        tenantId: 'tenant-1',
        subject: { kind: 'bulk_delete', id: 'incidents' },
        proposedBy: 'mr_mwikila',
        researchEvidenceIds: ['retention-policy'],
        nowIso: NOW,
      },
      affectedRowCount: 250,
      uuid: () => 'uuid-3',
    });
    expect(tripped).toContain('bulk_delete');
  });

  it('respects a critical recipe even if funds are zero', async () => {
    const recipe = fakeRecipe({
      id: 'killswitch_toggle',
      authority_tier: 2,
      is_critical: true,
      reversibility: 'fully',
    });
    const { tripped } = await buildProposal({
      recipe,
      context: {
        tenantId: 'tenant-1',
        subject: { kind: 'killswitch', id: 'eviction' },
        proposedBy: 'mr_mwikila',
        researchEvidenceIds: [],
        nowIso: NOW,
      },
      uuid: () => 'uuid-4',
    });
    expect(tripped).toContain('recipe_critical');
  });
});

describe('MutationRecipeRegistry', () => {
  it('registers and resolves latest live version', () => {
    const v1 = fakeRecipe({ version: 1, status: 'locked' });
    const v2 = fakeRecipe({ version: 2, status: 'live' });
    const reg = new MutationRecipeRegistry().register(v1).register(v2);
    expect(reg.resolveLatest('parcel_update')?.version).toBe(2);
    expect(reg.get('parcel_update', 1)?.status).toBe('locked');
  });

  it('throws on duplicate (id, version)', () => {
    const r = fakeRecipe();
    const reg = new MutationRecipeRegistry().register(r);
    expect(() => reg.register(r)).toThrow(/already registered/);
  });

  it('also surfaces approval records in tests', async () => {
    // Belt + braces — make sure ApprovalRecord type compiles + is
    // exercised via at least one synthetic shape in this file.
    const sample: ApprovalRecord = {
      proposal_id: 'p-1',
      approver_user_id: 'u-1',
      approver_role: 'owner',
      decision: 'approved',
      reasoning: 'ok',
      decided_at: NOW,
      audit_hash: 'hash',
    };
    expect(sample.approver_role).toBe('owner');
  });
});
