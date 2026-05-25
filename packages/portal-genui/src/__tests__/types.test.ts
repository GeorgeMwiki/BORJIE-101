/**
 * `PortalTabSchema` boundary tests — verifies the strict() refinements
 * + the cross-field validation (duplicate field keys, empty sections,
 * etc.).
 */

import { describe, it, expect } from 'vitest';
import {
  PortalTabSchema,
  parsePortalTab,
  safeParsePortalTab,
  PortalTabSectionSchema,
  TabGenerationIntentSchema,
} from '../types.js';
import { buildFallbackTab } from '../generator/fallbacks.js';

function freshTab() {
  return buildFallbackTab({
    intent: {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    },
    tenantId: 't',
    userId: null,
    actorId: 'system',
    nowIso: '2026-05-24T12:00:00.000Z',
    id: 'tab_a',
    sourceConversationId: undefined,
  });
}

describe('PortalTabSchema', () => {
  it('accepts a freshly built fallback tab', () => {
    expect(() => parsePortalTab(freshTab())).not.toThrow();
  });

  it('rejects an invalid tabKey', () => {
    const tab = { ...freshTab(), tabKey: 'NO CAPS' };
    expect(safeParsePortalTab(tab)).toBeNull();
  });

  it('rejects unknown top-level fields (strict mode)', () => {
    const tab = { ...freshTab(), unexpected: true };
    expect(safeParsePortalTab(tab)).toBeNull();
  });

  it('rejects duplicate field keys within a section', () => {
    const tab = freshTab();
    const tampered = {
      ...tab,
      sections: [
        {
          key: 's1',
          title: 'S1',
          fields: [
            { key: 'dup', label: 'L', kind: 'text' as const, required: true },
            { key: 'dup', label: 'L', kind: 'text' as const, required: true },
          ],
          widgets: [],
        },
      ],
    };
    expect(safeParsePortalTab(tampered)).toBeNull();
  });

  it('rejects section with no fields and no widgets', () => {
    const result = PortalTabSectionSchema.safeParse({
      key: 's',
      title: 'S',
      fields: [],
      widgets: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('TabGenerationIntentSchema', () => {
  it('accepts a well-formed intent', () => {
    const result = TabGenerationIntentSchema.safeParse({
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.5,
      evidence: ['payroll'],
      sourceMessage: 'we need to track our payroll',
      usedLlm: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const result = TabGenerationIntentSchema.safeParse({
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 1.5,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown domain', () => {
    const result = TabGenerationIntentSchema.safeParse({
      proposedTabKey: 'x.y',
      proposedTabTitle: 'X',
      domain: 'unknown_domain',
      confidence: 0.5,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    });
    expect(result.success).toBe(false);
  });
});
