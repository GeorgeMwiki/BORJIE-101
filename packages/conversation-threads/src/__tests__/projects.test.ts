/**
 * Tests for projects.ts.
 *
 * Cover:
 *   - tier gate refuses T5 customer creating a project
 *   - tier gate refuses T4 employee creating a project
 *   - T1/T2/T3 are allowed
 *   - update / archive / list / get round-trip
 *   - in-memory repository tenant isolation
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_TIER_FOR_PROJECTS,
  ProjectTierError,
  archiveProject,
  createInMemoryProjectRepository,
  createProject,
  getProject,
  listProjects,
  updateProject,
  type ProjectRepository,
} from '../projects.js';

describe('createProject — tier gate', () => {
  let repository: ProjectRepository;
  let count: number;
  beforeEach(() => {
    repository = createInMemoryProjectRepository();
    count = 0;
  });
  const idGenerator = (): string => {
    count += 1;
    return `p_${count}`;
  };

  it('refuses tier 5 (customer)', async () => {
    await expect(
      createProject({
        tenantId: 't_abc',
        ownerUserId: 'u_1',
        ownerPersonaId: 'persona_1',
        ownerPersonaTier: 5,
        name: 'My project',
        idGenerator,
        repository,
      }),
    ).rejects.toBeInstanceOf(ProjectTierError);
  });

  it('refuses tier 4 (employee)', async () => {
    await expect(
      createProject({
        tenantId: 't_abc',
        ownerUserId: 'u_1',
        ownerPersonaId: 'persona_1',
        ownerPersonaTier: 4,
        name: 'My project',
        idGenerator,
        repository,
      }),
    ).rejects.toBeInstanceOf(ProjectTierError);
  });

  it('accepts tiers 1, 2, 3', async () => {
    for (const tier of [1, 2, 3] as const) {
      const p = await createProject({
        tenantId: 't_abc',
        ownerUserId: 'u_1',
        ownerPersonaId: 'persona_1',
        ownerPersonaTier: tier,
        name: `Project T${tier}`,
        idGenerator,
        repository,
      });
      expect(p.id).toMatch(/^p_/);
    }
  });

  it('exposes MAX_TIER_FOR_PROJECTS = 3', () => {
    expect(MAX_TIER_FOR_PROJECTS).toBe(3);
  });

  it('attaches description, customInstructions, memoryScopeId when provided', async () => {
    const p = await createProject({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      ownerPersonaTier: 2,
      name: 'Full project',
      description: 'with details',
      customInstructions: 'always cite sources',
      memoryScopeId: 'mn_42',
      moduleScope: ['maintenance', 'leasing'],
      pinned: true,
      idGenerator,
      repository,
    });
    expect(p.description).toBe('with details');
    expect(p.customInstructions).toBe('always cite sources');
    expect(p.memoryScopeId).toBe('mn_42');
    expect([...(p.moduleScope ?? [])]).toEqual(['maintenance', 'leasing']);
    expect(p.pinned).toBe(true);
  });
});

describe('Project lifecycle', () => {
  it('round-trip create, get, update, archive, list', async () => {
    const repository = createInMemoryProjectRepository();
    let n = 0;
    const idGenerator = (): string => `p_${++n}`;

    const created = await createProject({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      ownerPersonaTier: 2,
      name: 'Original',
      idGenerator,
      repository,
    });
    const fetched = await getProject({
      tenantId: 't_abc',
      id: created.id,
      repository,
    });
    expect(fetched?.name).toBe('Original');

    const updated = await updateProject({
      tenantId: 't_abc',
      id: created.id,
      patch: { name: 'Renamed' },
      repository,
    });
    expect(updated.name).toBe('Renamed');

    const list1 = await listProjects({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      repository,
    });
    expect(list1.length).toBe(1);

    await archiveProject({
      tenantId: 't_abc',
      id: created.id,
      repository,
    });
    const list2 = await listProjects({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      repository,
    });
    expect(list2.length).toBe(0);
    const list3 = await listProjects({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      includeArchived: true,
      repository,
    });
    expect(list3.length).toBe(1);
  });

  it('returns null for non-existent project', async () => {
    const repository = createInMemoryProjectRepository();
    const out = await getProject({
      tenantId: 't_abc',
      id: 'missing',
      repository,
    });
    expect(out).toBeNull();
  });

  it('throws when updating a non-existent project', async () => {
    const repository = createInMemoryProjectRepository();
    await expect(
      updateProject({
        tenantId: 't_abc',
        id: 'missing',
        patch: { name: 'X' },
        repository,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('throws when archiving a non-existent project', async () => {
    const repository = createInMemoryProjectRepository();
    await expect(
      archiveProject({ tenantId: 't_abc', id: 'missing', repository }),
    ).rejects.toThrow(/not found/);
  });
});

describe('Tenant isolation', () => {
  it('does not leak rows across tenants in the in-memory repo', async () => {
    const repository = createInMemoryProjectRepository();
    let n = 0;
    const idGen = (): string => `p_${++n}`;
    await createProject({
      tenantId: 't_a',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      ownerPersonaTier: 2,
      name: 'tenant A project',
      idGenerator: idGen,
      repository,
    });
    await createProject({
      tenantId: 't_b',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      ownerPersonaTier: 2,
      name: 'tenant B project',
      idGenerator: idGen,
      repository,
    });
    const aList = await listProjects({
      tenantId: 't_a',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      repository,
    });
    const bList = await listProjects({
      tenantId: 't_b',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      repository,
    });
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(1);
    expect(aList[0]?.name).toBe('tenant A project');
    expect(bList[0]?.name).toBe('tenant B project');
  });
});
