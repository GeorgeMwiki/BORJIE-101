/**
 * Persona-aware brain-tool catalog — scope-tools tests.
 *
 * Covers the five scope tools wired by Wave SCOPE-SEGMENTATION:
 *   - scope.resolve_label
 *   - scope.roll_up_across_scopes
 *   - scope.compare_across_scopes
 *   - scope.cross_domain_scope_matrix
 *   - scope.taxonomy_display_for
 *
 * Verifies:
 *   - All five tools register with the expected ids
 *   - Each tool zod-validates its declared input shape (well-formed
 *     accepted; malformed rejected)
 *   - All five tools are exposed to BOTH owner (T1) and admin (T2)
 *     persona slugs
 *   - Persona gating refuses calls from other slugs (worker / buyer)
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  SCOPE_TOOLS,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  scopeResolveLabelTool,
  scopeRollUpTool,
  scopeCompareTool,
  scopeCrossDomainMatrixTool,
  scopeTaxonomyDisplayTool,
} from '../brain-tools/scope-tools';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function makeHttpClient(): PersonaToolHttpClient {
  return {
    async get<T>(_path: string): Promise<T> {
      return {
        kindCanonical: 'site',
        labelEn: 'Site',
        labelSw: 'Mgodi',
        resolved: 'Mgodi',
        defaultKind: 'site',
        displayLabelEn: { site: 'Site' },
        displayLabelSw: { site: 'Mgodi' },
        updatedAt: new Date().toISOString(),
      } as unknown as T;
    },
    async post<T>(_path: string, _body: Readonly<Record<string, unknown>>): Promise<T> {
      return {
        metricId: 'production.tonnes',
        total: 100,
        mean: 50,
        min: 30,
        max: 70,
        count: 2,
        perScope: [
          { scopeNodeId: UUID_A, value: 70 },
          { scopeNodeId: UUID_B, value: 30 },
        ],
        topScopeNodeId: UUID_A,
        bottomScopeNodeId: UUID_B,
        ranking: [
          { scopeNodeId: UUID_A, value: 70, rank: 1, deltaFromMean: 20 },
          { scopeNodeId: UUID_B, value: 30, rank: 2, deltaFromMean: -20 },
        ],
        scopeNodeIds: [UUID_A],
        domains: ['compliance'],
        cells: [{ scopeNodeId: UUID_A, domainId: 'compliance', status: 'green' }],
      } as unknown as T;
    },
  };
}

function gateFor(slug: string, httpClient: PersonaToolHttpClient): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => slug,
    httpClient,
  };
}

function ctx() {
  return {
    tenant: { tenantId: 't-1' } as never,
    actor: { id: 'u-1' } as never,
    persona: { id: 'p-1', allowedTools: [] } as never,
    threadId: 'th-1',
  } as never;
}

describe('scope-tools — registration', () => {
  it('exposes exactly five scope tools', () => {
    const ids = SCOPE_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'scope.compare_across_scopes',
      'scope.cross_domain_scope_matrix',
      'scope.resolve_label',
      'scope.roll_up_across_scopes',
      'scope.taxonomy_display_for',
    ]);
  });

  it('exposes every scope tool to BOTH owner and admin slugs', () => {
    for (const tool of SCOPE_TOOLS) {
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
      expect(tool.personaSlugs).toContain('T2_admin_strategist');
    }
  });

  it('flags every scope tool as read-only LOW stakes', () => {
    for (const tool of SCOPE_TOOLS) {
      expect(tool.isWrite).toBe(false);
      expect(tool.stakes).toBe('LOW');
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });
});

describe('scope-tools — zod validation', () => {
  it('accepts well-formed input for scope.resolve_label', () => {
    const parsed = scopeResolveLabelTool.inputSchema.safeParse({
      kindCanonical: 'pit',
      locale: 'sw',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty kind for scope.resolve_label', () => {
    const parsed = scopeResolveLabelTool.inputSchema.safeParse({
      kindCanonical: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-uuid scope ids for scope.roll_up_across_scopes', () => {
    const parsed = scopeRollUpTool.inputSchema.safeParse({
      scopeNodeIds: ['not-a-uuid'],
      metricId: 'production.tonnes',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects fewer than two scopes for scope.compare_across_scopes', () => {
    const parsed = scopeCompareTool.inputSchema.safeParse({
      scopeNodeIds: [UUID_A],
      metricId: 'production.tonnes',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts well-formed input for scope.cross_domain_scope_matrix', () => {
    const parsed = scopeCrossDomainMatrixTool.inputSchema.safeParse({
      scopeNodeIds: [UUID_A],
      domains: ['compliance', 'finance'],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts empty object for scope.taxonomy_display_for', () => {
    const parsed = scopeTaxonomyDisplayTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });
});

describe('scope-tools — execution', () => {
  it('runs scope.resolve_label as owner strategist', async () => {
    const handler = toBrainToolHandler(
      scopeResolveLabelTool,
      gateFor('T1_owner_strategist', makeHttpClient()),
    );
    const result = await handler.execute(
      { kindCanonical: 'site', locale: 'sw' },
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it('runs scope.roll_up_across_scopes as admin strategist', async () => {
    const handler = toBrainToolHandler(
      scopeRollUpTool,
      gateFor('T2_admin_strategist', makeHttpClient()),
    );
    const result = await handler.execute(
      {
        scopeNodeIds: [UUID_A, UUID_B],
        metricId: 'production.tonnes',
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses scope.resolve_label from worker slug (persona gating)', async () => {
    const handler = toBrainToolHandler(
      scopeResolveLabelTool,
      gateFor('T4_field_employee', makeHttpClient()),
    );
    const result = await handler.execute({ kindCanonical: 'pit' }, ctx());
    expect(result.ok).toBe(false);
  });
});
