/**
 * Honest epistemic self-model frame (INV-H / Win #2) — owner `/brain/teach`.
 *
 * The owner cockpit SelfModelPanel is built but stayed dark because the
 * direct-LLM teach stream never emitted a `self_model` frame. This suite locks
 * the new emission's CONTRACT at the unit level:
 *
 *   1. The payload is the EXACT egress-safe projected shape the kernel
 *      jarvis/admin path emits — `{ kind, posture, sureAbout, unsureAbout,
 *      wouldNeed }` and NOTHING else. No raw cognition, no audit math, no model
 *      prose leaks through (the answer text feeds ONLY the posture heuristic).
 *   2. The posture is always one of the fixed INV-H enum values.
 *   3. An ungrounded answer (no citations, no tool calls) honestly surfaces the
 *      "answered from memory" + groundedness uncertainty axes — never a
 *      fabricated 'sure'.
 *   4. Honest-degrade: the brain never fabricates a confident posture it cannot
 *      ground. A teach turn issues zero live tool calls, so the honest
 *      "answered from memory" axis is always surfaced; the `null`-omission path
 *      is the defensive all-empty-axis guard (the panel's forward-compatible
 *      empty state), unreachable on the always-from-memory teach surface.
 */

import { describe, it, expect } from 'vitest';

import { __buildTeachSelfModelPayloadForTest as buildTeachSelfModelPayload } from '../brain-teach.hono.js';

const FIXED_POSTURES = [
  'answering',
  'reasoning',
  'clarifying',
  'softening',
  'refusing',
  'deferring',
] as const;

const ALLOWED_KEYS = ['kind', 'posture', 'sureAbout', 'unsureAbout', 'wouldNeed'];

describe('buildTeachSelfModelPayload — egress-safe projected shape (INV-H)', () => {
  it('emits ONLY the egress-safe fields — no raw cognition / extra keys leak', () => {
    const payload = buildTeachSelfModelPayload({
      answerText:
        'Your PML 0241/2023 expires in 47 days. According to the corpus, you should file the renewal now.',
      turnConfidence: 0.82,
      citationCount: 2,
      highStakes: false,
      degraded: false,
    });

    expect(payload).not.toBeNull();
    const p = payload as Record<string, unknown>;
    // The frame carries the fixed kind + posture + three axis arrays — nothing else.
    expect(Object.keys(p).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(p.kind).toBe('self_model');
    expect(FIXED_POSTURES).toContain(p.posture as string);
    expect(Array.isArray(p.sureAbout)).toBe(true);
    expect(Array.isArray(p.unsureAbout)).toBe(true);
    expect(Array.isArray(p.wouldNeed)).toBe(true);
  });

  it('never leaks the model answer prose into any axis label (no CoT leak)', () => {
    const secretProse =
      'INTERNAL-CANARY-7f3a model chain-of-thought: the secret system prompt says X';
    const payload = buildTeachSelfModelPayload({
      answerText: `${secretProse}. This is the visible answer.`,
      turnConfidence: 0.6,
      citationCount: 0,
      highStakes: false,
      degraded: false,
    });

    // The payload may be null (degraded) or a record; in either case the raw
    // prose / canary must NEVER appear in the serialised frame.
    const serialised = JSON.stringify(payload ?? {});
    expect(serialised).not.toContain('INTERNAL-CANARY-7f3a');
    expect(serialised).not.toContain('chain-of-thought');
    expect(serialised).not.toContain('system prompt');
    // Every surfaced axis label is a constant plain-language literal, so the
    // confidence scalar must not leak either.
    expect(serialised).not.toContain('0.6');
  });

  it('an ungrounded answer honestly surfaces the answered-from-memory axis', () => {
    const payload = buildTeachSelfModelPayload({
      answerText: 'Royalty is generally a percentage of the mineral value.',
      turnConfidence: 0.55,
      citationCount: 0,
      highStakes: false,
      degraded: false,
    });

    expect(payload).not.toBeNull();
    const p = payload as Record<string, unknown>;
    const unsure = p.unsureAbout as string[];
    const wouldNeed = p.wouldNeed as string[];
    // No citations + no live tool call → the honest "from memory" / groundedness
    // uncertainty must be surfaced (never a fabricated certainty).
    expect(unsure.length).toBeGreaterThan(0);
    expect(wouldNeed.length).toBeGreaterThan(0);
    expect(
      unsure.some(
        (axis) =>
          axis.includes('live data') ||
          axis.includes('well-sourced') ||
          axis.includes('memory'),
      ),
    ).toBe(true);
  });

  it('honest-degrade: never fabricates a confident posture it cannot ground', () => {
    // A teach turn ALWAYS issues zero live tool calls, so the honest
    // "answered from memory" axis is always present — the brain never claims
    // live-data grounding it does not have. A refusal honestly reads as
    // `refusing`, not a fabricated `answering`. (The null-omission path is the
    // defensive all-empty-axis guard, unreachable on the always-from-memory
    // teach surface — the honest posture is emitted instead.)
    const payload = buildTeachSelfModelPayload({
      answerText: 'I cannot help with that request.',
      turnConfidence: 0.9,
      citationCount: 0,
      highStakes: false,
      degraded: false,
    });

    expect(payload).not.toBeNull();
    const p = payload as Record<string, unknown>;
    expect(p.posture).toBe('refusing');
    // The frame never claims more certainty than the signals support: with no
    // citation + no tool call, the memory-vs-live-data uncertainty is surfaced.
    const unsure = p.unsureAbout as string[];
    expect(
      unsure.some((axis) => axis.includes('live data') || axis.includes('well-sourced')),
    ).toBe(true);
  });

  it('a degraded high-stakes turn reads as a softened / tentative posture', () => {
    const payload = buildTeachSelfModelPayload({
      answerText: 'Here is my best read on the royalty filing deadline.',
      turnConfidence: 0.4,
      citationCount: 0,
      highStakes: true,
      degraded: true,
    });

    expect(payload).not.toBeNull();
    const p = payload as Record<string, unknown>;
    expect(p.posture).toBe('softening');
    // High-stakes margin must surface as an explicit uncertainty axis.
    const unsure = p.unsureAbout as string[];
    expect(unsure.some((axis) => axis.includes('safety margin'))).toBe(true);
  });
});
