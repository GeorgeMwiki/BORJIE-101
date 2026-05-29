/**
 * Tests for seeds.ts.
 *
 * Verifies the built-in catalogue (5 titles + 7 base personas + 8 mining
 * role personas = 15 total) and the idempotent seed helper. Counts are
 * derived dynamically from `BUILT_IN_TITLES` / `BUILT_IN_PERSONAS` so new
 * additions to the catalogue do not require test edits — only the
 * coverage assertion below needs updating when a new slug is added.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PERSONAS,
  BUILT_IN_TITLES,
  renderMemoryNamespaceKey,
  seedBuiltInTitlesAndPersonas,
  type SeedPort,
} from '../seeds.js';
import type { Persona, Title } from '../types.js';

describe('Built-in catalogue', () => {
  it('seeds exactly five titles, one per tier', () => {
    expect(BUILT_IN_TITLES.length).toBe(5);
    const tiers = BUILT_IN_TITLES.map((t) => t.powerTier).sort();
    expect(tiers).toEqual([1, 2, 3, 4, 5]);
  });

  it('seeds 7 base personas + 8 mining role personas (15 total)', () => {
    expect(BUILT_IN_PERSONAS.length).toBe(15);
    const slugs = BUILT_IN_PERSONAS.map((p) => p.slug).sort();
    expect(slugs).toEqual([
      'T1_buyer_marketplace_director',
      'T1_compliance_clerk',
      'T1_geologist',
      'T1_manager_dispatch',
      'T1_owner_strategist',
      'T1_pit_operator',
      'T1_safety_officer',
      'T1_supervisor_shift',
      'T1_treasury_clerk',
      'T2_admin_strategist',
      'T3_module_manager',
      'T4_field_employee',
      'T5_customer_concierge',
      'T_auditor',
      'T_vendor',
    ]);
  });

  it('customer concierge can answer over WhatsApp + SMS', () => {
    const cust = BUILT_IN_PERSONAS.find(
      (p) => p.slug === 'T5_customer_concierge',
    );
    expect(cust?.channelAllowlist).toContain('whatsapp');
    expect(cust?.channelAllowlist).toContain('sms');
  });

  it('auditor has read-only tool catalog and LOW ceiling', () => {
    const aud = BUILT_IN_PERSONAS.find((p) => p.slug === 'T_auditor');
    expect(aud?.maxActionTier).toBe('LOW');
    expect(aud?.toolCatalogIds.every((id) => id.endsWith('.read'))).toBe(
      true,
    );
  });
});

describe('renderMemoryNamespaceKey', () => {
  it('renders all five tokens', () => {
    const key = renderMemoryNamespaceKey({
      template: 'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}',
      tokens: {
        tenant_id: 't_abc',
        persona_slug: 'estate_officer',
        project_id: 'p_42',
      },
    });
    expect(key).toBe(
      'tenant:t_abc:persona:estate_officer:project:p_42',
    );
  });

  it('collapses missing tokens to "nil"', () => {
    const key = renderMemoryNamespaceKey({
      template: 'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}',
      tokens: { tenant_id: 't_abc' },
    });
    expect(key).toBe('tenant:t_abc:persona:nil:project:nil');
  });

  it('replaces all occurrences of a token', () => {
    const key = renderMemoryNamespaceKey({
      template: '{tenant_id}/{tenant_id}',
      tokens: { tenant_id: 't_abc' },
    });
    expect(key).toBe('t_abc/t_abc');
  });

  it('does not mangle non-token literal braces', () => {
    const key = renderMemoryNamespaceKey({
      template: 'tenant:{tenant_id}:literal:{not_a_token}',
      tokens: { tenant_id: 't_abc' },
    });
    // {not_a_token} is left alone because the replacer only touches
    // the known token set.
    expect(key).toContain('{not_a_token}');
    expect(key).toContain('t_abc');
  });
});

describe('seedBuiltInTitlesAndPersonas — idempotent', () => {
  function makePort(args: {
    readonly existingTitles?: ReadonlyArray<string>;
    readonly existingPersonas?: ReadonlyArray<string>;
    readonly insertedTitles?: Title[];
    readonly insertedPersonas?: Persona[];
  }): SeedPort & {
    titles: Title[];
    personas: Persona[];
  } {
    const titles: Title[] = [...(args.insertedTitles ?? [])];
    const personas: Persona[] = [...(args.insertedPersonas ?? [])];
    let n = 0;
    return {
      titles,
      personas,
      async existingTitleSlugs() {
        return args.existingTitles ?? [];
      },
      async existingPersonaSlugs() {
        return args.existingPersonas ?? [];
      },
      async insertTitles({ rows }) {
        for (const r of rows) titles.push(r);
      },
      async insertPersonas({ rows }) {
        for (const r of rows) personas.push(r);
      },
      generateId({ kind }) {
        n += 1;
        return `${kind}_${n}`;
      },
    };
  }

  it('inserts all titles + personas on first run', async () => {
    const port = makePort({});
    const out = await seedBuiltInTitlesAndPersonas({
      tenantId: 't_abc',
      port,
    });
    expect(out.titlesInserted.length).toBe(BUILT_IN_TITLES.length);
    expect(out.personasInserted.length).toBe(BUILT_IN_PERSONAS.length);
    expect(port.titles.length).toBe(BUILT_IN_TITLES.length);
    expect(port.personas.length).toBe(BUILT_IN_PERSONAS.length);
  });

  it('inserts nothing on a re-run', async () => {
    const port = makePort({
      existingTitles: BUILT_IN_TITLES.map((t) => t.slug),
      existingPersonas: BUILT_IN_PERSONAS.map((p) => p.slug),
    });
    const out = await seedBuiltInTitlesAndPersonas({
      tenantId: 't_abc',
      port,
    });
    expect(out.titlesInserted.length).toBe(0);
    expect(out.personasInserted.length).toBe(0);
  });

  it('inserts only the missing rows on a partial re-run', async () => {
    const existingTitles = ['owner', 'admin'];
    const existingPersonas = ['T1_owner_strategist', 'T_vendor'];
    const port = makePort({
      existingTitles,
      existingPersonas,
    });
    const out = await seedBuiltInTitlesAndPersonas({
      tenantId: 't_abc',
      port,
    });
    expect(out.titlesInserted.length).toBe(
      BUILT_IN_TITLES.length - existingTitles.length,
    );
    expect(out.personasInserted.length).toBe(
      BUILT_IN_PERSONAS.length - existingPersonas.length,
    );
  });

  it('seeded rows carry is_built_in = true', async () => {
    const port = makePort({});
    await seedBuiltInTitlesAndPersonas({ tenantId: 't_abc', port });
    expect(port.titles.every((t) => t.isBuiltIn === true)).toBe(true);
    expect(port.personas.every((p) => p.isBuiltIn === true)).toBe(true);
  });
});
