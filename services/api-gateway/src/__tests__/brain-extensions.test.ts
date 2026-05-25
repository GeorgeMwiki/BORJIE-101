/**
 * Brain-extensions smoke test.
 *
 * Verifies the Wave-15 wiring-audit fix: the org-awareness
 * `query_organization` skill is reachable from the Brain's tool
 * dispatcher after boot-time registration. Previously this skill was
 * defined in `packages/ai-copilot/src/skills/org/index.ts` but never
 * hooked into the skill registry, making it unreachable from chat.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setBrainExtraSkills,
  getBrainExtraSkills,
} from '../composition/brain-extensions';
import {
  buildQueryOrganizationTool,
  createBrainForTesting,
} from '@borjie/ai-copilot';

describe('brain-extensions wiring', () => {
  beforeEach(() => {
    setBrainExtraSkills([]);
  });

  it('starts empty (no skills wired)', () => {
    expect(getBrainExtraSkills()).toEqual([]);
  });

  it('accepts an injected skill and returns it back', () => {
    const tool = buildQueryOrganizationTool({
      async answer() {
        return {
          headline: 'stub',
          detail: 'stub',
          blackboard: { kind: 'status_summary' as const, rows: [] },
        } as never;
      },
    });
    setBrainExtraSkills([tool]);
    const extras = getBrainExtraSkills();
    expect(extras).toHaveLength(1);
    expect(extras[0].name).toBe('skill.org.query_organization');
  });

  it('makes the extra skill reachable via the Brain ToolDispatcher', async () => {
    const tool = buildQueryOrganizationTool({
      async answer(req) {
        return {
          headline: `answered for ${req.tenantId}: ${req.question}`,
          detail: 'deterministic stub',
          blackboard: { kind: 'status_summary' as const, rows: [] },
        } as never;
      },
    });
    const brain = createBrainForTesting({ extraSkills: [tool] });
    const registered = brain.tools.list().map((t) => t.name);
    expect(registered).toContain('skill.org.query_organization');
  });
});
