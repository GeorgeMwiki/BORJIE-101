/**
 * Tests for CSA-3 + CSA-4 capability brain tools.
 *
 * Verifies:
 *   - Both tools resolve through the catalog merge (index.ts).
 *   - what_can_you_do returns 1-3 disclosure-safe entries.
 *   - what_can_you_do honours the optional topic filter.
 *   - mwikila.about returns a persona-preserving response per intent.
 *   - Outputs contain ZERO leakage tokens (defense in depth alongside
 *     the registry test).
 */

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_TOOLS,
  whatCanYouDoTool,
  aboutTool,
} from '../capability-tools';
import { listPersonaToolDescriptors } from '../index';

const FORBIDDEN_LEAK_TOKENS = [
  'anthropic',
  'openai',
  'deepseek',
  'gpt-',
  'claude-',
  'sonnet',
  'haiku',
  'mcp',
  '/services/',
  '/packages/',
  'kernel',
  '12-agent',
  '27 specialist juniors',
  '27 juniors',
  'central-intelligence',
  'brain-tools',
  'drizzle',
  'pgvector',
];

const STUB_CTX = Object.freeze({
  tenantId: 'tenant-test',
  actorId: 'actor-test',
  personaSlug: 'T1_owner_strategist',
});

const collectText = (value: unknown, acc: string[] = []): string[] => {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, acc);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>))
      collectText(child, acc);
  }
  return acc;
};

const assertNoLeakage = (value: unknown): void => {
  const allText = collectText(value).join('\n').toLowerCase();
  for (const token of FORBIDDEN_LEAK_TOKENS) {
    expect(allText.includes(token), `leakage token "${token}" detected`).toBe(false);
  }
};

describe('CSA-3 mwikila.capabilities.what_can_you_do', () => {
  it('appears in the merged brain catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.capabilities.what_can_you_do');
  });

  it('returns 3 entries by default with bilingual fields', async () => {
    const out = await whatCanYouDoTool.handler(
      { language: 'en', limit: 3 },
      STUB_CTX,
    );
    expect(out.capabilities.length).toBeGreaterThan(0);
    expect(out.capabilities.length).toBeLessThanOrEqual(3);
    for (const cap of out.capabilities) {
      expect(cap.public_name.en).toBeTruthy();
      expect(cap.public_name.sw).toBeTruthy();
      expect(cap.public_description.en).toBeTruthy();
      expect(cap.public_description.sw).toBeTruthy();
      expect(cap.example_question.en).toBeTruthy();
      expect(cap.example_response_pattern.en).toBeTruthy();
      // Internal fields must not leak.
      expect(Object.keys(cap)).not.toContain('id');
      expect(Object.keys(cap)).not.toContain('visibility');
      expect(Object.keys(cap)).not.toContain('related');
    }
  });

  it('honours topic filter (drafting -> only drafting entries)', async () => {
    const out = await whatCanYouDoTool.handler(
      { topic: 'drafting', language: 'en', limit: 3 },
      STUB_CTX,
    );
    expect(out.topic).toBe('drafting');
    expect(out.capabilities.length).toBeGreaterThan(0);
    for (const cap of out.capabilities) {
      // Drafting entries should contain "draft" semantics in EN or SW.
      const combined = `${cap.public_name.en} ${cap.public_description.en}`.toLowerCase();
      expect(combined).toMatch(/draft|template|loi|rfp|payslip|letter/);
    }
  });

  it('emits a non-empty bilingual summary and invitation', async () => {
    const out = await whatCanYouDoTool.handler({ language: 'sw', limit: 2 }, STUB_CTX);
    expect(out.summary.en.length).toBeGreaterThan(10);
    expect(out.summary.sw.length).toBeGreaterThan(10);
    expect(out.invitation.en.length).toBeGreaterThan(10);
    expect(out.invitation.sw.length).toBeGreaterThan(10);
  });

  it('refuses leakage tokens in any field', async () => {
    const out = await whatCanYouDoTool.handler({ language: 'en' }, STUB_CTX);
    assertNoLeakage(out);
  });
});

describe('CSA-4 mwikila.about', () => {
  it('appears in the merged brain catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.about');
  });

  it('answers each of the five intents in both languages', async () => {
    const intents = [
      'who_are_you',
      'how_does_this_work',
      'are_you_ai',
      'what_about_mistakes',
      'data_privacy',
    ] as const;
    for (const intent of intents) {
      const out = await aboutTool.handler({ intent, language: 'en' }, STUB_CTX);
      expect(out.intent).toBe(intent);
      expect(out.response.en.length).toBeGreaterThan(20);
      expect(out.response.sw.length).toBeGreaterThan(20);
      expect(out.next_action.capability_name.en).toBeTruthy();
      expect(out.next_action.example_question.en).toBeTruthy();
    }
  });

  it('preserves persona — never names the underlying model', async () => {
    const out = await aboutTool.handler({ intent: 'are_you_ai' }, STUB_CTX);
    const combined = `${out.response.en} ${out.response.sw}`.toLowerCase();
    expect(combined).not.toMatch(/chatgpt|claude|gpt|openai|anthropic|deepseek/);
    expect(combined).toMatch(/mwikila/);
    expect(combined).toMatch(/borjie/);
  });

  it('refuses leakage tokens in any output', async () => {
    const intents = [
      'who_are_you',
      'how_does_this_work',
      'are_you_ai',
      'what_about_mistakes',
      'data_privacy',
    ] as const;
    for (const intent of intents) {
      const out = await aboutTool.handler({ intent }, STUB_CTX);
      assertNoLeakage(out);
    }
  });
});

describe('CAPABILITY_TOOLS catalog', () => {
  it('exports both tools with LOW stakes and isWrite=false', () => {
    expect(CAPABILITY_TOOLS.length).toBe(2);
    for (const tool of CAPABILITY_TOOLS) {
      expect(tool.stakes).toBe('LOW');
      expect(tool.isWrite).toBe(false);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });

  it('grants access to all 5 user-facing personas', () => {
    for (const tool of CAPABILITY_TOOLS) {
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
      expect(tool.personaSlugs).toContain('T2_admin_strategist');
      expect(tool.personaSlugs).toContain('T3_module_manager');
      expect(tool.personaSlugs).toContain('T4_field_employee');
      expect(tool.personaSlugs).toContain('T5_customer_concierge');
    }
  });
});
