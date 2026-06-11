/**
 * Skill-capture loop tests — the Voyager
 * solve→verify→describe→embed→store→compose path + the single completion
 * hook. Covers the verify gate, evidence gate, step-count gate,
 * templatisation, composition, slug collision, audit chaining, the
 * LearnedShortcut emission, and human-review gating.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  captureSkillOnCompletion,
  runCaptureLoop,
  createHeuristicDescriber,
  captureAuditHash,
  canonicalJson,
  toSkillSlug,
  suffixSlug,
  GENESIS_HASH,
  MIN_STEPS_FOR_CAPTURE,
  type CompletedTask,
  type CaptureHookOptions,
} from '../index.js';
import { VoyagerSkillLibrary } from '../../voyager-library/index.js';
import { embed } from '../../builtin-skills/embed.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const FIXED = new Date('2026-06-08T09:00:00.000Z');

function mkTask(overrides: Partial<CompletedTask> = {}): CompletedTask {
  return {
    tenant_id: 't-tz',
    jurisdiction: 'TZ',
    intent: 'pay the monthly royalty for site A',
    steps: [
      { tool: 'mining.compute_royalty', args: { site_id: 'A', rate: 0.06 }, success: true },
      { tool: 'mining.draft_filing', args: { site_id: 'A' }, success: true },
    ],
    params: { siteId: 'A' },
    verified: true,
    correlation_id: 'cid-1',
    evidence_ids: ['ev-1'],
    ...overrides,
  };
}

function mkOpts(
  library: VoyagerSkillLibrary,
  overrides: Partial<CaptureHookOptions> = {},
): CaptureHookOptions {
  return {
    describer: createHeuristicDescriber(),
    embedder: embed,
    library,
    now: () => FIXED,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Happy path — solve→verify→describe→embed→store→compose
// ─────────────────────────────────────────────────────────────────────

describe('captureSkillOnCompletion — happy path', () => {
  it('captures a verified multi-step task into a permanent skill', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));

    expect(res.captured).toBe(true);
    if (!res.captured) return;
    expect(lib.size()).toBe(1);
    expect(lib.get(res.skill.id)).toBeDefined();
    expect(res.skill.jurisdiction).toBe('TZ');
    expect(res.skill.embedding.length).toBeGreaterThan(0);
    expect(res.skill.success_count).toBe(0);
    expect(res.skill.quarantined).toBe(false);
  });

  it('emits a LearnedShortcut keyed on the new skill id', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));
    if (!res.captured) throw new Error('expected capture');
    expect(res.shortcut.id).toBe(`skill:${res.skill.id}`);
    expect(res.shortcut.label).toBe(res.skill.name);
    expect(res.shortcut.confidence).toBeGreaterThan(0);
    expect(res.shortcut.confidence).toBeLessThanOrEqual(1);
  });

  it('templatises caller-supplied param values into {{param}} placeholders', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));
    if (!res.captured) throw new Error('expected capture');
    // The site_id 'A' (param siteId) must be templatised in the body.
    expect(res.skill.code.source).toContain('{{siteId}}');
    // And the captured plan should not leak the raw 'A' value as a tool arg.
    const out = (await res.skill.code.run(
      {
        entity_store: {} as never,
        tenant_id: 't',
        jurisdiction: 'TZ',
        correlation_id: 'c',
        now: FIXED.toISOString(),
      },
      { siteId: 'A' },
    )) as { plan: ReadonlyArray<{ tool: string; args_template: Record<string, unknown> }> };
    expect(out.plan[0]?.args_template.site_id).toBe('{{siteId}}');
  });

  it('the captured skill is human-review-gated (cannot auto-fire)', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));
    if (!res.captured) throw new Error('expected capture');
    // The audit payload stamps human_reviewed:false; the body is a
    // replay PLAN (returns the plan, never executes a tool).
    expect(res.skill.code.source).toContain('human-review-gated');
    const out = (await res.skill.code.run(
      {
        entity_store: {} as never,
        tenant_id: 't',
        jurisdiction: 'TZ',
        correlation_id: 'c',
        now: FIXED.toISOString(),
      },
      {},
    )) as { plan: unknown[] };
    // Running it produces a plan, not a side effect.
    expect(Array.isArray(out.plan)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Gates — verify / evidence / step-count (rail-composing: ADD-only)
// ─────────────────────────────────────────────────────────────────────

describe('captureSkillOnCompletion — gates', () => {
  it('skips when the task did NOT verify (verify gate is mandatory)', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask({ verified: false }), mkOpts(lib));
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('not_verified');
    expect(lib.size()).toBe(0);
  });

  it('skips when no evidence_id is supplied (evidence-required rule)', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask({ evidence_ids: [] }), mkOpts(lib));
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('no_evidence');
    expect(lib.size()).toBe(0);
  });

  it('skips a single-step task (not a reusable multi-step procedure)', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(
      mkTask({
        steps: [{ tool: 'mining.compute_royalty', args: {}, success: true }],
      }),
      mkOpts(lib),
    );
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('too_few_steps');
    expect(lib.size()).toBe(0);
  });

  it('drops failed steps and skips if too few succeed', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(
      mkTask({
        steps: [
          { tool: 'a', args: {}, success: true },
          { tool: 'b', args: {}, success: false },
        ],
      }),
      mkOpts(lib),
    );
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('too_few_steps');
  });

  it('skips when all steps failed', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await runCaptureLoop(
      mkTask({
        steps: [
          { tool: 'a', args: {}, success: false },
          { tool: 'b', args: {}, success: false },
        ],
      }),
      mkOpts(lib),
    );
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('no_successful_steps');
  });

  it('MIN_STEPS_FOR_CAPTURE boundary: exactly the minimum captures', async () => {
    expect(MIN_STEPS_FOR_CAPTURE).toBe(2);
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));
    expect(res.captured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// describe stage failures
// ─────────────────────────────────────────────────────────────────────

describe('describe stage', () => {
  it('returns describe_failed when the describer throws', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(
      mkTask(),
      mkOpts(lib, {
        describer: async () => {
          throw new Error('claude unavailable');
        },
      }),
    );
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('describe_failed');
    expect(res.detail).toContain('claude unavailable');
    expect(lib.size()).toBe(0);
  });

  it('returns describe_failed when the describer returns an empty name', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(
      mkTask(),
      mkOpts(lib, {
        describer: async () => ({ name: '   ', description: 'x' }),
      }),
    );
    expect(res.captured).toBe(false);
    if (res.captured) return;
    expect(res.reason).toBe('describe_failed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// compose stage
// ─────────────────────────────────────────────────────────────────────

describe('compose stage', () => {
  it('records composed_from when a similar skill already exists', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const desc = 'Reusable royalty filing procedure for TZ tenants';
    // Seed a skill whose embedding is identical to what the capture will
    // produce (same describer output → same embedding).
    const fixedDescriber = async () => ({ name: 'Pay Royalty', description: desc });
    const seeded = await runCaptureLoop(
      mkTask(),
      mkOpts(lib, { describer: fixedDescriber }),
    );
    expect(seeded.captured).toBe(true);

    // Second capture of analogous work composes off the first.
    const second = await runCaptureLoop(
      mkTask({ correlation_id: 'cid-2', intent: 'pay the monthly royalty for site B' }),
      mkOpts(lib, { describer: fixedDescriber }),
    );
    expect(second.captured).toBe(true);
    if (!second.captured) return;
    expect(second.composed_from).not.toBeNull();
  });

  it('composed_from is null for a genuinely novel capability', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(mkTask(), mkOpts(lib));
    if (!res.captured) throw new Error('expected capture');
    expect(res.composed_from).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// slug collision
// ─────────────────────────────────────────────────────────────────────

describe('slug collision', () => {
  it('resolves a deterministic free slug when the name repeats', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const sameName = async () => ({ name: 'Pay Royalty', description: 'desc one two' });
    const a = await runCaptureLoop(mkTask(), mkOpts(lib, { describer: sameName }));
    const b = await runCaptureLoop(
      mkTask({ correlation_id: 'cid-2', intent: 'another royalty run x y z' }),
      mkOpts(lib, { describer: async () => ({ name: 'Pay Royalty', description: 'totally different vector qqq' }) }),
    );
    expect(a.captured && b.captured).toBe(true);
    if (!a.captured || !b.captured) return;
    expect(a.skill.id).not.toBe(b.skill.id);
    expect(b.skill.id).toBe('pay-royalty-2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// slug helpers
// ─────────────────────────────────────────────────────────────────────

describe('toSkillSlug / suffixSlug', () => {
  it('normalises a name into a valid slug', () => {
    expect(toSkillSlug('Pay Royalty!! Now')).toBe('pay-royalty-now');
  });

  it('falls back to "skill" when nothing survives', () => {
    expect(toSkillSlug('!!!')).toBe('skill');
    expect(toSkillSlug('123')).toBe('skill');
  });

  it('caps at 64 chars', () => {
    const long = 'a'.repeat(200);
    expect(toSkillSlug(long).length).toBeLessThanOrEqual(64);
  });

  it('suffixSlug keeps within the slug pattern', () => {
    expect(suffixSlug('pay-royalty', 2)).toBe('pay-royalty-2');
    expect(suffixSlug('a'.repeat(70), 3).length).toBeLessThanOrEqual(64);
  });
});

// ─────────────────────────────────────────────────────────────────────
// audit chaining
// ─────────────────────────────────────────────────────────────────────

describe('capture audit hashing', () => {
  it('is deterministic for the same payload + prev', () => {
    const payload = { event: 'skill_captured', skill_id: 'x' };
    const h1 = captureAuditHash(payload, GENESIS_HASH);
    const h2 = captureAuditHash(payload, GENESIS_HASH);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-independent over object keys (canonical JSON)', () => {
    const a = captureAuditHash({ a: 1, b: 2 });
    const b = captureAuditHash({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('chains: a different prev produces a different hash', () => {
    const payload = { event: 'skill_captured', skill_id: 'x' };
    const genesis = captureAuditHash(payload, GENESIS_HASH);
    const chained = captureAuditHash(payload, genesis);
    expect(chained).not.toBe(genesis);
  });

  it('canonicalJson sorts nested keys', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [3, { f: 1, e: 2 }] })).toBe(
      '{"a":[3,{"e":2,"f":1}],"b":{"c":2,"d":1}}',
    );
  });

  it('the capture result carries a 64-hex audit_hash that chains from prev', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const res = await captureSkillOnCompletion(
      mkTask(),
      mkOpts(lib, { prevAuditHash: 'deadbeef' }),
    );
    if (!res.captured) throw new Error('expected capture');
    expect(res.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// entry-boundary errors
// ─────────────────────────────────────────────────────────────────────

describe('entry-boundary errors', () => {
  it('throws when task is missing', async () => {
    const lib = new VoyagerSkillLibrary();
    await expect(
      captureSkillOnCompletion(undefined as never, mkOpts(lib)),
    ).rejects.toThrow(/task is required/);
  });

  it('throws when required opts are missing', async () => {
    await expect(
      captureSkillOnCompletion(mkTask(), {} as never),
    ).rejects.toThrow(/library.*describer.*embedder/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// logger
// ─────────────────────────────────────────────────────────────────────

describe('logger', () => {
  it('logs an info line on a successful capture', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => FIXED });
    const info = vi.fn();
    await captureSkillOnCompletion(mkTask(), mkOpts(lib, { logger: { info } }));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('captured new skill'),
      expect.objectContaining({ cid: 'cid-1' }),
    );
  });
});
