/**
 * spawn.test.ts — exercises both spawn entry points with fake ports.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  spawnModuleFromTemplate,
  spawnModuleFromPrompt,
} from '../spawn.js';
import { makeFakeState, makeFakeDeps, type FakeState } from './fakes.js';
import { estateBundle } from '@borjie/module-templates';

function seedEstateTemplate(state: FakeState): void {
  state.templates.set('ESTATE', {
    id: 'mtpl_estate',
    slug: 'ESTATE',
    defaultSpec: estateBundle.spec as unknown as Readonly<Record<string, unknown>>,
    titleEn: 'Estate Management',
    titleSw: 'Usimamizi wa Mali',
  });
}

describe('spawnModuleFromTemplate', () => {
  let state: FakeState;
  beforeEach(() => {
    state = makeFakeState();
    seedEstateTemplate(state);
  });

  it('creates a module + spec and transitions to PROPOSED', async () => {
    const deps = makeFakeDeps(state);
    const r = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'ESTATE',
        moduleSlug: 'estate_trc_hq',
        title: 'Estate Management — HQ',
        titleSw: 'Usimamizi wa Mali — Makao Makuu',
        scopedToolIds: ['graph.query', 'docs.search'],
        createdByUserId: 'usr_admin',
      },
      deps,
    );

    expect(r.ok).toBe(true);
    expect(r.moduleId).toMatch(/^mod_/);
    expect(r.specId).toMatch(/^mspec_/);
    expect(r.migrationSql).toContain('CREATE TABLE');

    const stored = state.modules.get(r.moduleId!)!;
    expect(stored.lifecycleState).toBe('PROPOSED');
    expect(stored.specId).toBe(r.specId);
    expect(stored.vectorNamespace).toMatch(/^tnt:tnt_trc:mod:mod_/);

    const spec = state.specs.get(r.specId!)!;
    expect(spec.compileStatus).toBe('compiled');
    expect(spec.migrationSql.length).toBeGreaterThan(0);
  });

  it('fails when template slug is unknown', async () => {
    const deps = makeFakeDeps(state);
    const r = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_x',
        templateSlug: 'GHOST',
        moduleSlug: 'mod_x',
        title: 'X',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: null,
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/unknown template/);
  });
});

describe('spawnModuleFromPrompt', () => {
  let state: FakeState;
  beforeEach(() => {
    state = makeFakeState();
  });

  it('accepts an LLM-emitted valid spec', async () => {
    const deps = makeFakeDeps(state);
    const candidate = estateBundle.spec; // a known-good shape
    const r = await spawnModuleFromPrompt(
      {
        tenantId: 'tnt_trc',
        persona: 'estate_manager',
        moduleSlug: 'estate_llm_authored',
        title: 'Estate (LLM-authored)',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_pm',
        candidateSpec: candidate,
      },
      deps,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an LLM spec that violates the grammar', async () => {
    const deps = makeFakeDeps(state);
    const bad = { entities: [{ slug: 'bad slug!' }], workflows: [], ui_sections: [] };
    const r = await spawnModuleFromPrompt(
      {
        tenantId: 'tnt_trc',
        persona: 'estate_manager',
        moduleSlug: 'mod_bad',
        title: 'Bad',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: null,
        candidateSpec: bad,
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects an LLM spec attempting SQL injection in a slug', async () => {
    const deps = makeFakeDeps(state);
    const sqli = {
      entities: [
        {
          slug: "ghost'; DROP TABLE tenants; --",
          display_name_en: 'pwn',
          fields: [{ name: 'x', kind: 'text', required: true }],
        },
      ],
      workflows: [],
      ui_sections: [],
    };
    const r = await spawnModuleFromPrompt(
      {
        tenantId: 'tnt_x',
        persona: 'estate_manager',
        moduleSlug: 'mod_pwn',
        title: 'pwn',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: null,
        candidateSpec: sqli,
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/slug/);
  });
});

describe('cross-tenant isolation', () => {
  it('Tenant B cannot read Tenant A modules via findModule', async () => {
    const state = makeFakeState();
    seedEstateTemplate(state);
    const deps = makeFakeDeps(state);

    const a = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_a',
        templateSlug: 'ESTATE',
        moduleSlug: 'mod_a',
        title: 'A',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: null,
      },
      deps,
    );
    expect(a.ok).toBe(true);

    // Tenant B asks for tenant A's module — must return null.
    const cross = await deps.modules.findModule({
      tenantId: 'tnt_b',
      id: a.moduleId!,
    });
    expect(cross).toBeNull();
  });
});
