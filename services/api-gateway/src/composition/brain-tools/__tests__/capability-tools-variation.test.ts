/**
 * RT-6 — variation probe.
 *
 * Verifies the capability tools return REASONING CONTEXT (a scaffolding
 * the model uses to compose fresh per turn) rather than pre-composed
 * answer strings.
 *
 * The tool layer is DETERMINISTIC by design — it returns the same shape
 * for the same input. Variation happens in the MODEL layer when it
 * synthesizes the reply using:
 *   - The shape returned by the tool (capability context)
 *   - The explicit `compose_guidance` directive
 *   - Live tenant data + the current conversation
 *
 * This test proves:
 *   1. Three identical invocations return the same deterministic shape
 *      (proves the tool is a CONTEXT PROVIDER, not a randomizer).
 *   2. The `compose_guidance` field is present and explicitly tells the
 *      model to VARY across turns (proves the tool's output is scaffolding
 *      for synthesis, not a script to recite).
 *   3. The capability shapes carry distinct topic / outcome fields per
 *      invocation argument (proves the tool reasons about WHAT context
 *      to surface from the registry, not which words to say).
 *
 * The audit doc `Docs/AUDIT/REAL_TIME_REASONING_2026-05-29.md` cites
 * this test as the evidence artefact for RT-6.
 */

import { describe, expect, it } from 'vitest';

import { aboutTool, whatCanYouDoTool } from '../capability-tools';

const STUB_CTX = Object.freeze({
  tenantId: 'tenant-rt6',
  actorId: 'owner-rt6',
  personaSlug: 'T1_owner_strategist',
});

describe('RT-6 — variation probe (tool is CONTEXT, model produces variation)', () => {
  it('what_can_you_do is deterministic per input (tool layer, not a randomizer)', async () => {
    const a = await whatCanYouDoTool.handler(
      { topic: 'drafting', language: 'en', limit: 3 },
      STUB_CTX,
    );
    const b = await whatCanYouDoTool.handler(
      { topic: 'drafting', language: 'en', limit: 3 },
      STUB_CTX,
    );
    const c = await whatCanYouDoTool.handler(
      { topic: 'drafting', language: 'en', limit: 3 },
      STUB_CTX,
    );
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('what_can_you_do includes compose_guidance directing the model to VARY', async () => {
    const out = await whatCanYouDoTool.handler(
      { language: 'en', limit: 3 },
      STUB_CTX,
    );
    expect(out.compose_guidance.length).toBeGreaterThan(50);
    const lower = out.compose_guidance.toLowerCase();
    // The directive must teach the model to compose fresh / vary.
    expect(lower).toMatch(/fresh|vary|variation|compose|reason/);
    expect(lower).toMatch(/never quote|not.*verbatim|reference.*shape|grounding/);
  });

  it('about is deterministic per intent (tool layer, not a randomizer)', async () => {
    const a = await aboutTool.handler({ intent: 'are_you_ai' }, STUB_CTX);
    const b = await aboutTool.handler({ intent: 'are_you_ai' }, STUB_CTX);
    const c = await aboutTool.handler({ intent: 'are_you_ai' }, STUB_CTX);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('about includes compose_guidance directing the model to VARY', async () => {
    const out = await aboutTool.handler({ intent: 'are_you_ai' }, STUB_CTX);
    expect(out.compose_guidance.length).toBeGreaterThan(50);
    const lower = out.compose_guidance.toLowerCase();
    expect(lower).toMatch(/fresh|vary|variation|compose|reason/);
    expect(lower).toMatch(/never quote|not.*verbatim|shape|grounding/);
  });

  it('what_can_you_do reasons about WHICH capabilities to surface per topic', async () => {
    const drafting = await whatCanYouDoTool.handler(
      { topic: 'drafting', language: 'en', limit: 3 },
      STUB_CTX,
    );
    const tracking = await whatCanYouDoTool.handler(
      { topic: 'tracking', language: 'en', limit: 3 },
      STUB_CTX,
    );
    expect(drafting.topic).toBe('drafting');
    expect(tracking.topic).toBe('tracking');
    // The capability sets MUST differ — proves the tool is selecting
    // context, not returning a fixed string.
    const draftingNames = drafting.capabilities
      .map((c) => c.public_name.en)
      .join('|');
    const trackingNames = tracking.capabilities
      .map((c) => c.public_name.en)
      .join('|');
    expect(draftingNames).not.toBe(trackingNames);
  });

  it('about routes different intents to different capability next_actions', async () => {
    const privacy = await aboutTool.handler(
      { intent: 'data_privacy' },
      STUB_CTX,
    );
    const mistakes = await aboutTool.handler(
      { intent: 'what_about_mistakes' },
      STUB_CTX,
    );
    // Different intents must route to different next-action capabilities.
    expect(privacy.next_action.capability_name.en).not.toBe(
      mistakes.next_action.capability_name.en,
    );
  });
});
