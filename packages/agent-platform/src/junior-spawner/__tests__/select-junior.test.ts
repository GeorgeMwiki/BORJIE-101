/**
 * select-junior.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts the 8-step algorithm honours the precedence order:
 *   seed > tenant_authored > spawned > spawn_new
 *
 * Each branch is exercised by a focused fixture pool.
 */

import { describe, expect, it } from 'vitest';
import { selectJunior } from '../selection/select-junior.js';
import { createInMemoryJuniorRepository } from '../storage/junior-repository.js';
import type {
  JuniorSpawnRequest,
  PersistedJuniorRecord,
} from '../types.js';

function makeJunior(
  overrides: Partial<PersistedJuniorRecord>,
): PersistedJuniorRecord {
  return {
    id: 'junior',
    display_name: 'Mr. Mwikila',
    subtitle: "Borjie's AI Generic Specialist",
    specialisation: 'Generic',
    provenance: 'seed',
    lifecycle_status: 'live',
    scope: {
      data_tables: [],
      tab_recipes_owned: [],
      doc_recipes_owned: [],
      media_recipes_owned: [],
      research_topics: ['shift', 'planning'],
      authority_tier_max: 1,
      requires_md_for_tier_2: true,
    },
    modes: [],
    escalation_policy: {
      auto_escalate_above_authority_tier: 1,
      auto_escalate_on_cross_domain: true,
      auto_escalate_on_low_confidence: true,
      hand_off_transcript_to_mr_mwikila: true,
    },
    target_audiences: ['manager'],
    authority_tier_max: 1,
    tenant_id: null,
    usage_count: 10,
    avg_satisfaction: 0.8,
    last_used_at: new Date('2026-01-01'),
    spawned_by_user_id: null,
    spawned_from_turn_id: null,
    promoted_at: null,
    locked_at: null,
    deprecated_at: null,
    ...overrides,
  };
}

function makeRequest(): JuniorSpawnRequest {
  return {
    tenant_id: 'tenant-a',
    user_id: 'user-1',
    intent_natural_language: 'plan the next shift',
    research_session_handle: null,
    active_scope: {
      scope_id: 'scope-a',
      audience: 'manager',
      intent_keywords: ['shift', 'planning'],
    },
  };
}

describe('selectJunior', () => {
  it('returns use_seed when a seed scores at threshold', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({ id: 'seed-shift', provenance: 'seed' }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('use_seed');
    expect(decision.junior_id).toBe('seed-shift');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('prefers seed over tenant_authored at equal score', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({ id: 'seed-shift', provenance: 'seed' }),
      makeJunior({
        id: 'tenant-shift',
        provenance: 'tenant_authored',
        tenant_id: 'tenant-a',
        lifecycle_status: 'live',
      }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('use_seed');
  });

  it('uses tenant_authored when no seed matches', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({
        id: 'tenant-shift',
        provenance: 'tenant_authored',
        tenant_id: 'tenant-a',
        lifecycle_status: 'live',
      }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('use_tenant_authored');
    expect(decision.junior_id).toBe('tenant-shift');
  });

  it('uses spawned when no seed/tenant_authored matches', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({
        id: 'spawned-shift',
        provenance: 'spawned',
        tenant_id: 'tenant-a',
        lifecycle_status: 'live',
      }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('use_spawned');
  });

  it('returns spawn_new when no eligible junior matches', async () => {
    const repo = createInMemoryJuniorRepository([]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('spawn_new');
    expect(decision.junior_id).toBe('');
  });

  it('skips spawned juniors in draft status', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({
        id: 'draft-shift',
        provenance: 'spawned',
        tenant_id: 'tenant-a',
        lifecycle_status: 'draft',
      }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('spawn_new');
  });

  it('does not use a tenant_authored junior from a different tenant', async () => {
    const repo = createInMemoryJuniorRepository([
      makeJunior({
        id: 'tenant-shift-other',
        provenance: 'tenant_authored',
        tenant_id: 'tenant-b',
        lifecycle_status: 'live',
      }),
    ]);
    const decision = await selectJunior(makeRequest(), { repository: repo });
    expect(decision.kind).toBe('spawn_new');
  });
});
