import { describe, expect, it } from 'vitest';
import { buildScopedMDContext, ROOT_PERSONA } from '../md-factory/scoped-md-factory.js';
import type { ResolvedScope } from '../types.js';

function scope(overrides: Partial<ResolvedScope> = {}): ResolvedScope {
  return {
    kind: 'tenant_root',
    tenant_id: 't-borjie',
    org_unit_ids: [],
    authority_tier_max: 2,
    visible_tables_filter: {
      tenant_id: 't-borjie',
      org_unit_ids: [],
      include_descendants: false,
    },
    visible_juniors: [],
    visible_recipes: [],
    resolved_terminology: {
      tenant_id: 't-borjie',
      scope_path: null,
      entries: new Map(),
    },
    legacy_mode: false,
    ...overrides,
  };
}

describe('buildScopedMDContext', () => {
  it('uses the canonical persona by default', () => {
    const ctx = buildScopedMDContext({ scope: scope() });
    expect(ctx.persona.persona_id).toBe('mr-mwikila');
    expect(ctx.persona.display_name).toBe(ROOT_PERSONA.display_name);
  });

  it('builds a tenant-scoped audit persona id at the root', () => {
    const ctx = buildScopedMDContext({ scope: scope() });
    expect(ctx.audit_persona_id).toBe('mr-mwikila@t-borjie');
    expect(ctx.visible_table_filter_token).toContain('root');
  });

  it('builds a scope-path-scoped audit persona id for an org_unit', () => {
    const ctx = buildScopedMDContext({
      scope: scope({
        kind: 'org_unit',
        org_unit_ids: ['geita'],
        resolved_terminology: {
          tenant_id: 't-borjie',
          scope_path: 'borjie/geita',
          entries: new Map(),
        },
      }),
    });
    expect(ctx.audit_persona_id).toBe('mr-mwikila@borjie/geita');
    expect(ctx.visible_table_filter_token).toContain('geita');
  });

  it('accepts a custom persona override', () => {
    const ctx = buildScopedMDContext({
      scope: scope(),
      persona: {
        persona_id: 'mwikila-jr',
        display_name: 'Mr. Mwikila Jr.',
        mandate: 'sub-org delegate',
      },
    });
    expect(ctx.persona.persona_id).toBe('mwikila-jr');
    expect(ctx.audit_persona_id.startsWith('mwikila-jr@')).toBe(true);
  });

  it('shows org_unit_ids in the visible_table_filter_token for multi scope', () => {
    const ctx = buildScopedMDContext({
      scope: scope({
        kind: 'multi_org_unit',
        org_unit_ids: ['geita', 'mererani'],
      }),
    });
    expect(ctx.visible_table_filter_token).toContain('geita');
    expect(ctx.visible_table_filter_token).toContain('mererani');
  });
});
