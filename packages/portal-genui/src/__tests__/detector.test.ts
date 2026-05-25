/**
 * Intent-detector tests — including the LLM-escalator path with a
 * stub brain port. The brain stub is deterministic so the tests are
 * fast + offline.
 */

import { describe, it, expect, vi } from 'vitest';
import { detectTabGenerationIntent, hasTabGenerationIntent } from '../intent/detector.js';
import type { BrainPort } from '../intent/detector.js';

function makeBrain(text: string): BrainPort {
  return {
    classify: vi.fn().mockResolvedValue({ text }),
  };
}

describe('detectTabGenerationIntent — heuristic-only', () => {
  it('returns null for a greeting', async () => {
    const out = await detectTabGenerationIntent({ message: 'hello team' });
    expect(out).toBeNull();
  });

  it('returns a classified intent for HR / payroll', async () => {
    const out = await detectTabGenerationIntent({
      message: 'we need to track our staff payroll',
    });
    expect(out?.domain).toBe('hr');
    expect(out?.proposedTabKey).toMatch(/^hr\./);
    expect(out?.usedLlm).toBe(false);
  });

  it('returns null on empty input', async () => {
    const out = await detectTabGenerationIntent({ message: '' });
    expect(out).toBeNull();
  });

  it('does not call the brain when heuristic is confident', async () => {
    const brain = makeBrain('{"intent":false}');
    await detectTabGenerationIntent(
      { message: "let's create a new tab to track our staff payroll" },
      { brain },
    );
    expect(brain.classify).not.toHaveBeenCalled();
  });
});

describe('detectTabGenerationIntent — LLM escalator', () => {
  it('escalates when heuristic is ambiguous and accepts an LLM yes', async () => {
    // Message has an intent verb but a non-domain target -> medium conf -> escalate.
    const brain = makeBrain(
      JSON.stringify({
        intent: true,
        tabKey: 'custom.research.notes',
        tabTitle: 'Research notes',
        domain: 'custom',
        evidence: ['research notes'],
        confidence: 0.75,
      }),
    );
    const out = await detectTabGenerationIntent(
      { message: 'we need to track our research notes' },
      { brain },
    );
    expect(brain.classify).toHaveBeenCalledTimes(1);
    expect(out?.domain).toBe('custom');
    expect(out?.proposedTabKey).toBe('custom.research.notes');
    expect(out?.usedLlm).toBe(true);
  });

  it('returns null when the LLM says intent=false', async () => {
    const brain = makeBrain(JSON.stringify({ intent: false }));
    const out = await detectTabGenerationIntent(
      { message: 'we need to track our research notes' },
      { brain },
    );
    expect(out).toBeNull();
  });

  it('falls back to heuristic when the LLM throws', async () => {
    const brain: BrainPort = {
      classify: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const out = await detectTabGenerationIntent(
      { message: "let's track our marketing campaigns" },
      { brain },
    );
    // Heuristic should still classify this as marketing.
    expect(out?.domain).toBe('marketing');
  });

  it('tolerates fenced JSON from the LLM', async () => {
    const brain = makeBrain(
      '```json\n' +
        JSON.stringify({
          intent: true,
          tabKey: 'engineering.runbook',
          tabTitle: 'Runbook',
          domain: 'engineering',
          evidence: ['runbook'],
          confidence: 0.6,
        }) +
        '\n```',
    );
    const out = await detectTabGenerationIntent(
      { message: 'we need to record our oncall runbooks' },
      { brain },
    );
    expect(out?.domain).toBe('engineering');
  });

  it('tolerates prose-wrapped JSON from the LLM', async () => {
    const brain = makeBrain(
      'Sure! Here you go: ' +
        JSON.stringify({
          intent: true,
          tabKey: 'legal.contracts',
          tabTitle: 'Contracts',
          domain: 'legal',
          evidence: ['contracts'],
          confidence: 0.55,
        }) +
        ' Hope that helps.',
    );
    const out = await detectTabGenerationIntent(
      { message: 'we need to keep track of all our contracts' },
      { brain },
    );
    expect(out?.domain).toBe('legal');
  });

  it('rejects garbage LLM output', async () => {
    const brain = makeBrain('lol idk');
    const out = await detectTabGenerationIntent(
      { message: 'we need to track our XYZ assets' },
      { brain },
    );
    expect(out).toBeNull();
  });
});

describe('detectTabGenerationIntent — guards', () => {
  it('downgrades confidence when proposedTabKey already exists', async () => {
    const out = await detectTabGenerationIntent({
      message: "let's set up our HR payroll tab",
      currentTabKeys: ['hr.payroll'],
    });
    // The heuristic chose hr.payroll → existing-tab check downgrades.
    if (out?.proposedTabKey === 'hr.payroll') {
      expect(out.confidence).toBeLessThanOrEqual(0.3);
      expect(out.evidence.some((e) => e.startsWith('tab_key_exists:'))).toBe(true);
    }
  });

  it('downgrades when domain not allowed for role=customer', async () => {
    const out = await detectTabGenerationIntent({
      message: "let's create a new compliance audit tab",
      role: 'customer',
    });
    if (out) {
      expect(out.confidence).toBeLessThanOrEqual(0.1);
    } else {
      expect(out).toBeNull();
    }
  });

  it('respects custom escalate band', async () => {
    const brain = makeBrain('{"intent":false}');
    await detectTabGenerationIntent(
      { message: 'we need to track our research things' },
      { brain, escalateBand: [0.0, 1.0] },
    );
    expect(brain.classify).toHaveBeenCalled();
  });
});

describe('hasTabGenerationIntent', () => {
  it('returns true for high-confidence classifications', async () => {
    const ok = await hasTabGenerationIntent({
      message: 'we need to track our staff payroll',
    });
    expect(ok).toBe(true);
  });

  it('returns false for greetings', async () => {
    const ok = await hasTabGenerationIntent({ message: 'hi' });
    expect(ok).toBe(false);
  });
});
