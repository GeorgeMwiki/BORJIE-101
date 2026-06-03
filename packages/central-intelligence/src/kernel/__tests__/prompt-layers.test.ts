/**
 * Prompt layers — LP-06 (deterministic ordering) + LP-09 (security layers).
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSystemPrompt,
  systemFragmentOrderSignature,
  SYSTEM_FRAGMENT_SLOTS,
  IP_PROTECTION_LAYER,
  SECURITY_BOUNDARY_LAYER,
  SECURITY_LAYERS,
  type SystemFragments,
} from '../prompt-layers.js';

describe('LP-06 — deterministic megaprompt ordering', () => {
  it('emits fragments in canonical slot order regardless of key-insertion order', () => {
    // Insert keys in REVERSE order; output must still be canonical.
    const reversed: SystemFragments = {
      cohortMix: 'COHORT',
      grounding: 'GROUND',
      identity: 'IDENT',
      personaPrelude: 'PERSONA',
    };
    const out = assembleSystemPrompt(reversed, { includeSecurityLayers: false });
    const lines = out.split('\n');
    expect(lines).toEqual(['PERSONA', 'IDENT', 'GROUND', 'COHORT']);
  });

  it('is byte-identical for identical inputs (prompt-cache stability)', () => {
    const fragments: SystemFragments = {
      personaPrelude: 'You are Mr. Mwikila.',
      identity: 'Locus: tenant.',
      grounding: 'Royalty rate is 6%.',
    };
    const a = assembleSystemPrompt(fragments);
    const b = assembleSystemPrompt({ ...fragments });
    expect(a).toBe(b);
  });

  it('drops empty / whitespace-only fragments without shifting present ones', () => {
    const out = assembleSystemPrompt(
      {
        personaPrelude: 'P',
        identity: '   ',
        moduleInventory: '',
        grounding: 'G',
      },
      { includeSecurityLayers: false },
    );
    expect(out).toBe('P\nG');
  });

  it('order signature is stable + versioned', () => {
    const sig = systemFragmentOrderSignature();
    expect(sig.startsWith('v1:')).toBe(true);
    expect(sig).toContain(SYSTEM_FRAGMENT_SLOTS[0]);
    expect(sig).toContain(SYSTEM_FRAGMENT_SLOTS[SYSTEM_FRAGMENT_SLOTS.length - 1]);
  });

  it('slot list has no duplicates', () => {
    const set = new Set(SYSTEM_FRAGMENT_SLOTS);
    expect(set.size).toBe(SYSTEM_FRAGMENT_SLOTS.length);
  });
});

describe('LP-09 — IP-protection + security-boundary layers', () => {
  it('always appends BOTH security layers, last, in fixed order', () => {
    const out = assembleSystemPrompt({ personaPrelude: 'P' });
    const idxIp = out.indexOf(IP_PROTECTION_LAYER);
    const idxBoundary = out.indexOf(SECURITY_BOUNDARY_LAYER);
    expect(idxIp).toBeGreaterThan(-1);
    expect(idxBoundary).toBeGreaterThan(-1);
    // IP protection precedes the terminal security boundary.
    expect(idxIp).toBeLessThan(idxBoundary);
    // Security boundary is the LAST block.
    expect(out.endsWith(SECURITY_BOUNDARY_LAYER)).toBe(true);
  });

  it('appends security layers even when every dynamic fragment is empty', () => {
    const out = assembleSystemPrompt({});
    expect(out).toBe([IP_PROTECTION_LAYER, SECURITY_BOUNDARY_LAYER].join('\n'));
  });

  it('can be disabled for non-production assemblers', () => {
    const out = assembleSystemPrompt({ personaPrelude: 'P' }, { includeSecurityLayers: false });
    expect(out).toBe('P');
  });

  it('SECURITY_LAYERS constant matches the appended order', () => {
    expect(SECURITY_LAYERS).toEqual([IP_PROTECTION_LAYER, SECURITY_BOUNDARY_LAYER]);
  });

  it('security layers resist prompt-injection by naming the attack patterns', () => {
    // The boundary layer must explicitly neutralise the canonical jailbreak
    // phrases so a model reading it knows to ignore them in untrusted data.
    expect(SECURITY_BOUNDARY_LAYER.toLowerCase()).toContain('ignore previous');
    expect(SECURITY_BOUNDARY_LAYER.toLowerCase()).toContain('untrusted');
    expect(IP_PROTECTION_LAYER.toLowerCase()).toContain('confidential');
  });

  it('contains no em-dash in the customer-adjacent security copy', () => {
    expect(IP_PROTECTION_LAYER).not.toContain('—');
    expect(SECURITY_BOUNDARY_LAYER).not.toContain('—');
  });
});
