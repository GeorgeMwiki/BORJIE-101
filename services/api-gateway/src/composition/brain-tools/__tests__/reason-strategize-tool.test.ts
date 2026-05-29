/**
 * Tests for RT-7 mwikila.reason.strategize.
 *
 * Verifies:
 *   - Tool resolves through the merged brain catalog.
 *   - Default depth='quick' returns 2 strategies.
 *   - depth='thorough' returns 3-4 strategies.
 *   - recommended_index points at a real strategy in the trace.
 *   - compose_guidance explicitly tells the model to compose fresh
 *     and never quote the scaffold verbatim.
 *   - grounding_tools name the brain tools the model should call
 *     to fill in the *_prompt placeholders with live data.
 *   - scope_filter passes through correctly.
 *   - personaSlugs gate: T1, T2, T3 only — worker / buyer / auditor
 *     are NOT allowed (strategic reasoning is leadership tier).
 *   - Output contains zero leakage tokens.
 */

import { describe, expect, it } from 'vitest';

import {
  REASON_STRATEGIZE_TOOLS,
  reasonStrategizeTool,
} from '../reason-strategize-tool';
import { listPersonaToolDescriptors } from '../index';

const STUB_CTX = Object.freeze({
  tenantId: 'tenant-rt7',
  actorId: 'owner-rt7',
  personaSlug: 'T1_owner_strategist',
});

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
  'central-intelligence',
  'brain-tools',
  'drizzle',
  'pgvector',
];

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

describe('RT-7 mwikila.reason.strategize', () => {
  it('appears in the merged brain catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('mwikila.reason.strategize');
  });

  it('declared LOW stakes + read-only + no policy literal needed', () => {
    expect(reasonStrategizeTool.stakes).toBe('LOW');
    expect(reasonStrategizeTool.isWrite).toBe(false);
    expect(reasonStrategizeTool.requiresPolicyRuleLiteral).toBe(false);
  });

  it('grants access to T1 owner + T2 admin + T3 manager only', () => {
    expect(reasonStrategizeTool.personaSlugs).toContain('T1_owner_strategist');
    expect(reasonStrategizeTool.personaSlugs).toContain('T2_admin_strategist');
    expect(reasonStrategizeTool.personaSlugs).toContain('T3_module_manager');
    expect(reasonStrategizeTool.personaSlugs).not.toContain('T4_field_employee');
    expect(reasonStrategizeTool.personaSlugs).not.toContain(
      'T5_customer_concierge',
    );
  });

  it('default depth="quick" returns 2 strategies', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Should I expand to Geita next month?' },
      STUB_CTX,
    );
    expect(out.depth).toBe('quick');
    expect(out.trace.strategies.length).toBe(2);
  });

  it('depth="thorough" returns 4 strategies', async () => {
    const out = await reasonStrategizeTool.handler(
      {
        question: 'Should I expand to Geita next month?',
        depth: 'thorough',
      },
      STUB_CTX,
    );
    expect(out.depth).toBe('thorough');
    expect(out.trace.strategies.length).toBe(4);
  });

  it('recommended_index points at a real strategy', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test', depth: 'thorough' },
      STUB_CTX,
    );
    expect(out.trace.recommended_index).toBeGreaterThanOrEqual(0);
    expect(out.trace.recommended_index).toBeLessThan(out.trace.strategies.length);
    const recommended = out.trace.strategies[out.trace.recommended_index];
    expect(recommended).toBeDefined();
    expect(recommended!.name.length).toBeGreaterThan(0);
  });

  it('every strategy carries pros + cons + evidence_prompt + confidence', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test', depth: 'thorough' },
      STUB_CTX,
    );
    for (const s of out.trace.strategies) {
      expect(s.pros.length).toBeGreaterThan(0);
      expect(s.cons.length).toBeGreaterThan(0);
      expect(s.evidence_prompt.length).toBeGreaterThan(10);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('trace carries current_state / why / downsides / grade plan prompts', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test' },
      STUB_CTX,
    );
    expect(out.trace.current_state_prompt.length).toBeGreaterThan(20);
    expect(out.trace.why_prompt.length).toBeGreaterThan(20);
    expect(out.trace.downsides_prompt.length).toBeGreaterThan(20);
    expect(out.trace.retrospective_grade_plan.length).toBeGreaterThan(20);
    expect(out.trace.constraints.length).toBeGreaterThan(0);
  });

  it('compose_guidance tells the model to REASON, not quote', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test' },
      STUB_CTX,
    );
    const lower = out.compose_guidance.toLowerCase();
    expect(lower).toMatch(/reason|compose|fresh|vary/);
    expect(lower).toMatch(/never quote|not.*verbatim|scaffold/);
  });

  it('grounding_tools name brain tools the model should call for evidence', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test' },
      STUB_CTX,
    );
    expect(out.grounding_tools.length).toBeGreaterThan(0);
    for (const t of out.grounding_tools) {
      expect(t).toMatch(/^mwikila\./);
    }
  });

  it('scope_filter passes through to the output', async () => {
    const out = await reasonStrategizeTool.handler(
      {
        question: 'Test',
        scope_filter: { entity_type: 'site', entity_id: 'site-geita' },
      },
      STUB_CTX,
    );
    expect(out.scope_filter).not.toBeNull();
    expect(out.scope_filter?.entity_type).toBe('site');
    expect(out.scope_filter?.entity_id).toBe('site-geita');
  });

  it('refuses leakage tokens in any field', async () => {
    const out = await reasonStrategizeTool.handler(
      { question: 'Test', depth: 'thorough' },
      STUB_CTX,
    );
    const blob = collectText(out).join('\n').toLowerCase();
    for (const token of FORBIDDEN_LEAK_TOKENS) {
      expect(blob.includes(token), `leakage token "${token}" detected`).toBe(
        false,
      );
    }
  });

  it('exposes a stable REASON_STRATEGIZE_TOOLS catalog', () => {
    expect(REASON_STRATEGIZE_TOOLS.length).toBe(1);
    expect(REASON_STRATEGIZE_TOOLS[0]?.id).toBe('mwikila.reason.strategize');
  });
});
