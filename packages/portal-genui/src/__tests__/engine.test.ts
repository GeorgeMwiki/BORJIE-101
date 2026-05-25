/**
 * End-to-end engine façade tests — exercise the `createGenUIEngine`
 * happy path end-to-end with a stub brain so the assertion stays
 * deterministic.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGenUIEngine } from '../engine.js';

describe('createGenUIEngine — stub mode', () => {
  it('detects intent → generates → persists → lists', async () => {
    const engine = createGenUIEngine();
    const intent = await engine.detectIntent({
      message: 'we need to track our staff payroll',
    });
    expect(intent?.domain).toBe('hr');
    const result = await engine.generate({
      intent: intent!,
      tenantId: 't1',
      userId: 'u1',
      actorId: 'system',
    });
    expect(result.tab.tabKey).toBe(intent!.proposedTabKey);
    await engine.persist({ tab: result.tab });
    const tabs = await engine.list({ tenantId: 't1', userId: 'u1' });
    expect(tabs.length).toBe(1);
  });

  it('delete removes the tab', async () => {
    const engine = createGenUIEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our supplier onboarding',
    }))!;
    const out = await engine.generate({
      intent,
      tenantId: 't1',
      userId: 'u1',
      actorId: 'system',
    });
    await engine.persist({ tab: out.tab });
    const del = await engine.delete({
      tabId: out.tab.id,
      requesterId: 'system',
      tenantId: 't1',
    });
    expect(del.deleted).toBe(true);
  });

  it('routes through the brain when wired', async () => {
    const brain = {
      classify: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          intent: true,
          tabKey: 'custom.r-and-d',
          tabTitle: 'R and D',
          domain: 'custom',
          evidence: ['research'],
          confidence: 0.7,
        }),
      }),
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          tabKey: 'custom.r-and-d',
          title: 'R and D',
          description: 'd',
          icon: 'beaker',
          domain: 'custom',
          sections: [
            {
              key: 'a',
              title: 'A',
              fields: [
                { key: 'k', label: 'L', kind: 'text', required: true },
              ],
              widgets: [],
            },
          ],
          permissions: { visibleToPersonas: ['internal_admin'] },
        }),
      }),
    };
    const engine = createGenUIEngine({ brain });
    const intent = await engine.detectIntent({
      // Heuristic-ambiguous (verb present, custom domain) — forces escalation.
      message: "let's set up a new section for our R&D experiments",
    });
    expect(intent?.usedLlm).toBe(true);
    expect(brain.classify).toHaveBeenCalled();
    const result = await engine.generate({
      intent: intent!,
      tenantId: 't1',
      userId: null,
      actorId: 'system',
    });
    expect(result.source).toBe('llm');
    expect(brain.generate).toHaveBeenCalled();
  });
});
