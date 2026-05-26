import { describe, it, expect } from 'vitest';
import { brandGate } from '../gates/brand-gate.js';

describe('brand-gate', () => {
  it('passes for clean Mr. Mwikila text and token-only CSS', () => {
    const r = brandGate({
      userFacingText: 'Mr. Mwikila here. Production for Geita: 412 tonnes.',
      renderedSurface: '<div style="color: var(--color-signal-500)">x</div>',
    });
    expect(r.pass).toBe(true);
    expect(r.signal.signal).toBe('brand');
  });

  it('fails when the text claims a non-Mwikila persona', () => {
    const r = brandGate({
      userFacingText: "I'm the BORJIE AI assistant.",
      renderedSurface: '',
    });
    expect(r.pass).toBe(false);
    const personaIssues = (r.signal.evidence as { personaIssues: string[] })
      .personaIssues;
    expect(personaIssues.length).toBeGreaterThan(0);
  });

  it('fails when the rendered surface contains a raw hex color', () => {
    const r = brandGate({
      userFacingText: '',
      renderedSurface: '<div style="color:#C9A66B">x</div>',
      isUserFacing: false,
    });
    expect(r.pass).toBe(false);
    const tokenIssues = (r.signal.evidence as { tokenIssues: string[] })
      .tokenIssues;
    expect(tokenIssues).toContain('#C9A66B');
  });

  it('fails when the text contains a rejected brand-leak substring', () => {
    const r = brandGate({
      userFacingText: 'As a language model, I cannot help with that.',
      renderedSurface: '',
    });
    expect(r.pass).toBe(false);
  });
});
