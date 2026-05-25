/**
 * Generator tests — both the LLM-backed happy path (with a stub
 * brain) and the deterministic fallback path. Verifies validation,
 * caching, system-field overlay, and graceful failure modes.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTabGenerator } from '../generator/index.js';
import type {
  GeneratorBrainPort,
  GenerateTabInput,
} from '../generator/index.js';
import type { TabGenerationIntent } from '../types.js';

function baseIntent(
  overrides: Partial<TabGenerationIntent> = {},
): TabGenerationIntent {
  return {
    proposedTabKey: 'hr.payroll',
    proposedTabTitle: 'Payroll',
    domain: 'hr',
    confidence: 0.8,
    evidence: ['payroll'],
    sourceMessage: 'we need to track our staff payroll',
    usedLlm: false,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<GenerateTabInput> = {},
): GenerateTabInput {
  return {
    intent: baseIntent(),
    tenantId: 'tenant_1',
    userId: 'user_1',
    actorId: 'system',
    ...overrides,
  };
}

const fixedClock = () => new Date('2026-05-24T12:00:00.000Z');

describe('createTabGenerator — fallback path (no brain)', () => {
  it('produces a valid HR tab from the skeleton', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(result.source).toBe('fallback');
    expect(result.tab.domain).toBe('hr');
    expect(result.tab.tenantId).toBe('tenant_1');
    expect(result.tab.userId).toBe('user_1');
    expect(result.tab.sections.length).toBeGreaterThan(0);
  });

  it('produces a valid Finance tab from the skeleton', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(
      baseInput({
        intent: baseIntent({
          domain: 'finance',
          proposedTabKey: 'finance.budgets',
          proposedTabTitle: 'Budgets',
        }),
      }),
    );
    expect(result.tab.domain).toBe('finance');
    expect(result.tab.icon).toBe('banknote');
  });

  it('produces a valid Compliance tab from the skeleton', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(
      baseInput({
        intent: baseIntent({
          domain: 'compliance',
          proposedTabKey: 'compliance.controls',
          proposedTabTitle: 'Controls',
        }),
      }),
    );
    expect(result.tab.icon).toBe('shield-check');
    expect(result.tab.permissions.visibleToPersonas).toContain('internal_admin');
  });

  it('audit history records actor + source message', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(baseInput({ actorId: 'user_jane' }));
    expect(result.tab.audit.createdBy).toBe('user_jane');
    expect(result.tab.audit.history.length).toBe(1);
  });

  it('records source conversation id in audit when supplied', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(
      baseInput({ sourceConversationId: 'conv_xyz' }),
    );
    expect(result.tab.audit.sourceConversationId).toBe('conv_xyz');
  });
});

describe('createTabGenerator — LLM path', () => {
  it('uses the LLM output when it parses', async () => {
    const llmTab = {
      tabKey: 'hr.payroll',
      title: 'My Custom Payroll',
      description: 'LLM-drafted description',
      icon: 'wallet',
      domain: 'hr',
      sections: [
        {
          key: 'cycles',
          title: 'Pay cycles',
          fields: [
            {
              key: 'cycle',
              label: 'Cycle',
              kind: 'text',
              required: true,
            },
          ],
          widgets: [],
        },
      ],
      permissions: { visibleToPersonas: ['internal_admin'] },
    };
    const brain: GeneratorBrainPort = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify(llmTab),
        modelId: 'claude-opus',
      }),
    };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(result.source).toBe('llm');
    expect(result.tab.title).toBe('My Custom Payroll');
    expect(result.llmModelId).toBe('claude-opus');
  });

  it('falls back when the LLM returns garbage', async () => {
    const brain: GeneratorBrainPort = {
      generate: vi.fn().mockResolvedValue({ text: 'lol' }),
    };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(result.source).toBe('fallback');
  });

  it('falls back when the LLM JSON fails schema validation', async () => {
    const brain: GeneratorBrainPort = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          tabKey: 'X', // uppercase — invalid
          title: '',
          description: '',
          icon: '',
          domain: 'hr',
          sections: [],
          permissions: { visibleToPersonas: [] },
        }),
      }),
    };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(result.source).toBe('fallback');
  });

  it('falls back when the brain throws', async () => {
    const brain: GeneratorBrainPort = {
      generate: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(result.source).toBe('fallback');
  });

  it('extracts JSON from fenced markdown', async () => {
    const inner = {
      tabKey: 'finance.budgets',
      title: 'Budgets',
      description: 'b',
      icon: 'wallet',
      domain: 'finance',
      sections: [
        {
          key: 'a',
          title: 'A',
          fields: [{ key: 'x', label: 'X', kind: 'text', required: true }],
          widgets: [],
        },
      ],
      permissions: { visibleToPersonas: ['internal_admin'] },
    };
    const brain: GeneratorBrainPort = {
      generate: vi.fn().mockResolvedValue({
        text: '```json\n' + JSON.stringify(inner) + '\n```',
      }),
    };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(
      baseInput({
        intent: baseIntent({
          domain: 'finance',
          proposedTabKey: 'finance.budgets',
        }),
      }),
    );
    expect(result.source).toBe('llm');
  });
});

describe('createTabGenerator — cache', () => {
  it('returns cache hit for repeated identical intents', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const first = await gen.generate(baseInput());
    const second = await gen.generate(baseInput());
    expect(first.source).toBe('fallback');
    expect(second.source).toBe('cache');
  });

  it('cache hit emits a fresh id', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const a = await gen.generate(baseInput());
    const b = await gen.generate(baseInput());
    expect(a.tab.id).not.toBe(b.tab.id);
  });

  it('different intents do NOT share a cache slot', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const a = await gen.generate(baseInput());
    const b = await gen.generate(
      baseInput({
        intent: baseIntent({
          domain: 'finance',
          proposedTabKey: 'finance.budgets',
          proposedTabTitle: 'Budgets',
        }),
      }),
    );
    expect(a.tab.domain).toBe('hr');
    expect(b.tab.domain).toBe('finance');
    expect(b.source).toBe('fallback');
  });
});
