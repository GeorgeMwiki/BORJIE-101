import { describe, expect, it } from 'vitest';
import { createEthicsFramework } from '../index.js';

describe('createEthicsFramework — composition root', () => {
  it('wires every subsystem with an in-memory default store', () => {
    const f = createEthicsFramework({ jurisdiction: 'TZ' });
    expect(f.jurisdiction).toBe('TZ');
    expect(f.principles.length).toBe(12);
    expect(typeof f.consent.recordConsent).toBe('function');
    expect(typeof f.vulnerable.flagVulnerable).toBe('function');
    expect(typeof f.rightToExplanation.recordAutomatedDecision).toBe('function');
    expect(typeof f.darkPatterns.scanComponent).toBe('function');
    expect(typeof f.surveillance.registerSurveillanceDevice).toBe('function');
    expect(typeof f.accessibility.checkAccessibility).toBe('function');
  });

  it('respects custom principle registry', () => {
    const principles = [
      {
        id: 'custom',
        name: 'Custom',
        source: 'house rules',
        jurisdiction: 'GLOBAL' as const,
        severity: 'low' as const,
        applicableContext: ['ai-decision' as const],
      },
    ];
    const f = createEthicsFramework({ jurisdiction: 'KE', principles });
    expect(f.principles.length).toBe(1);
    expect(f.principles[0]?.id).toBe('custom');
  });
});
