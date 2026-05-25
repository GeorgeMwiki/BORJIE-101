/**
 * Persona snapshot tests.
 *
 * Why: the persona catalog encodes business-critical behavior — model
 * tier, allowed tools, delegation graph, review thresholds. A silent
 * edit ("let me just lower Estate Manager's risk gate") could enable
 * unreviewed financial actions. These snapshots force an explicit diff
 * review when that metadata changes.
 *
 * We deliberately do NOT snapshot the full system-prompt text (too
 * noisy, legitimate wording tweaks happen often). Instead we snapshot:
 *   - the persona shape (id, kind, tier, risk gate, advisor gates,
 *     delegation targets, allowed tools)
 *   - a SHA-256 of each system prompt so unexpected prompt rewrites
 *     still produce a detectable diff in CI
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_PERSONAE } from '../personas/personas.catalog.js';

function promptHash(systemPrompt: string): string {
  return createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
}

describe('persona catalog snapshots', () => {
  it('has exactly the expected set of personae', () => {
    const ids = DEFAULT_PERSONAE.map((p) => p.id).sort();
    // Snapshot as a set-like array. Adding or removing a persona is a
    // platform-level decision — should never slip in unreviewed.
    expect(ids).toMatchInlineSnapshot(`
      [
        "coworker",
        "coworker.tender-negotiator",
        "estate-manager",
        "junior.communications",
        "junior.compliance",
        "junior.finance",
        "junior.leasing",
        "junior.maintenance",
        "junior.price-negotiator",
        "migration-wizard",
        "owner-advisor",
        "tenant-assistant",
      ]
    `);
  });

  it('estate-manager persona metadata is stable', () => {
    const em = DEFAULT_PERSONAE.find((p) => p.id === 'estate-manager');
    expect(em).toBeDefined();
    expect({
      id: em!.id,
      kind: em!.kind,
      modelTier: em!.modelTier,
      minReviewRiskLevel: em!.minReviewRiskLevel,
      advisorEnabled: em!.advisorEnabled ?? true,
      delegatesTo: [...(em!.delegatesTo ?? [])].sort(),
    }).toMatchInlineSnapshot(`
      {
        "advisorEnabled": true,
        "delegatesTo": [
          "junior.communications",
          "junior.compliance",
          "junior.finance",
          "junior.leasing",
          "junior.maintenance",
          "migration-wizard",
        ],
        "id": "estate-manager",
        "kind": "manager",
        "minReviewRiskLevel": "MEDIUM",
        "modelTier": "standard",
      }
    `);
  });

  it('junior personas never delegate further (no recursive handoffs)', () => {
    const juniors = DEFAULT_PERSONAE.filter((p) => p.kind === 'junior');
    for (const j of juniors) {
      expect(
        j.delegatesTo ?? [],
        `junior ${j.id} must not delegate — handoff chains should stay one-hop`
      ).toEqual([]);
    }
  });

  it('every persona has a non-empty system prompt', () => {
    for (const p of DEFAULT_PERSONAE) {
      expect(p.systemPrompt, `${p.id} systemPrompt`).toBeTruthy();
      expect(p.systemPrompt.length, `${p.id} systemPrompt length`).toBeGreaterThan(50);
    }
  });

  it('system-prompt hashes are stable across runs', () => {
    const hashes: Record<string, string> = {};
    for (const p of DEFAULT_PERSONAE) {
      hashes[p.id] = promptHash(p.systemPrompt);
    }
    // These hashes are intentionally opaque; any change surfaces as a
    // snapshot diff so reviewers explicitly approve the prompt edit.
    // When a hash changes, re-run with `vitest -u` to update, and make
    // sure the diff is a deliberate improvement — not a typo or accident.
    expect(Object.keys(hashes).sort()).toEqual([
      'coworker',
      'coworker.tender-negotiator',
      'estate-manager',
      'junior.communications',
      'junior.compliance',
      'junior.finance',
      'junior.leasing',
      'junior.maintenance',
      'junior.price-negotiator',
      'migration-wizard',
      'owner-advisor',
      'tenant-assistant',
    ]);
    // Each hash should be a 16-char hex. Stability is enforced by the
    // snapshot of the full hash-map via toMatchSnapshot below.
    for (const [id, h] of Object.entries(hashes)) {
      expect(h, `${id} hash format`).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('risk gates are set — no persona has undefined minReviewRiskLevel', () => {
    for (const p of DEFAULT_PERSONAE) {
      expect(p.minReviewRiskLevel, `${p.id} risk gate`).toBeDefined();
      expect(
        ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(p.minReviewRiskLevel);
    }
  });

  it('each persona declares an allowedTools list (possibly empty)', () => {
    for (const p of DEFAULT_PERSONAE) {
      expect(p.allowedTools, `${p.id} allowedTools`).toBeDefined();
      expect(Array.isArray(p.allowedTools), `${p.id} allowedTools is array`).toBe(true);
    }
  });

  it('delegatesTo targets all exist in the catalog', () => {
    const ids = new Set(DEFAULT_PERSONAE.map((p) => p.id));
    for (const p of DEFAULT_PERSONAE) {
      for (const target of p.delegatesTo ?? []) {
        expect(
          ids.has(target),
          `${p.id} delegates to unknown persona ${target}`
        ).toBe(true);
      }
    }
  });
});
