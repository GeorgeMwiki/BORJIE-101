/**
 * Prompt layers — LP-06 (deterministic ordering) + LP-09 (security layers).
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSystemPrompt,
  assembleSystemPromptBlocks,
  systemFragmentOrderSignature,
  SYSTEM_FRAGMENT_SLOTS,
  STABLE_PREFIX_SLOTS,
  DYNAMIC_FRAGMENT_SLOTS,
  STABLE_PREFIX_SLOT_COUNT,
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
    // v2 — stable-prefix-first reorder + prompt-prefix cache breakpoint.
    expect(sig.startsWith('v2:')).toBe(true);
    expect(sig).toContain(SYSTEM_FRAGMENT_SLOTS[0]);
    expect(sig).toContain(SYSTEM_FRAGMENT_SLOTS[SYSTEM_FRAGMENT_SLOTS.length - 1]);
  });

  it('slot list has no duplicates', () => {
    const set = new Set(SYSTEM_FRAGMENT_SLOTS);
    expect(set.size).toBe(SYSTEM_FRAGMENT_SLOTS.length);
  });
});

describe('BRAIN §5 — stable-prefix-first ordering (prompt-prefix cache)', () => {
  it('places every STABLE prefix slot before every DYNAMIC slot', () => {
    for (const stable of STABLE_PREFIX_SLOTS) {
      const stableIdx = SYSTEM_FRAGMENT_SLOTS.indexOf(stable);
      for (const dynamic of DYNAMIC_FRAGMENT_SLOTS) {
        const dynamicIdx = SYSTEM_FRAGMENT_SLOTS.indexOf(dynamic);
        expect(stableIdx).toBeLessThan(dynamicIdx);
      }
    }
  });

  it('the stable prefix is the persona + tenant-agnostic block, in canonical order', () => {
    expect([...STABLE_PREFIX_SLOTS]).toEqual([
      'personaPrelude',
      'identity',
      'rolloutPrompt',
      'moduleInventory',
    ]);
    expect(STABLE_PREFIX_SLOT_COUNT).toBe(STABLE_PREFIX_SLOTS.length);
  });

  it('STABLE + DYNAMIC partition the slot list exactly (no slot lost or duplicated)', () => {
    expect([...SYSTEM_FRAGMENT_SLOTS]).toEqual([
      ...STABLE_PREFIX_SLOTS,
      ...DYNAMIC_FRAGMENT_SLOTS,
    ]);
    const union = new Set([...STABLE_PREFIX_SLOTS, ...DYNAMIC_FRAGMENT_SLOTS]);
    expect(union.size).toBe(SYSTEM_FRAGMENT_SLOTS.length);
  });

  it('grounding / memory / situational fragments are DYNAMIC, never cached', () => {
    // These vary per turn / per tenant — caching them would serve stale data.
    for (const slot of [
      'grounding',
      'semanticMemory',
      'reflectiveDigest',
      'reflexion',
      'feedback',
      'activeGoals',
      'cohortMix',
      'locus',
    ] as const) {
      expect(DYNAMIC_FRAGMENT_SLOTS).toContain(slot);
      expect(STABLE_PREFIX_SLOTS as ReadonlyArray<string>).not.toContain(slot);
    }
  });
});

describe('BRAIN §5 — segmented assembly (cache breakpoint placement)', () => {
  // A realistic full-prompt fragment record exercising every slot.
  const fullFragments: SystemFragments = {
    personaPrelude: 'You are Mr. Mwikila, the brain layer of Borjie.',
    taskScopedReflexion: '**Recent self-critiques**\nHedge uncited numbers.',
    identity: 'Surface: owner cockpit.',
    rolloutPrompt: 'Rollout: cohort-A behaviour active.',
    moduleInventory: 'Modules: licences, royalty, treasury, marketplace.',
    locus: 'Locus: tenant.',
    behaviouralDirective: 'Behavioural directive: be concise.',
    verbosityDirective: 'Verbosity directive: medium.',
    semanticMemory: 'Recalled: owner prefers TZS summaries.',
    reflectiveDigest: 'Digest: last week royalty filings clean.',
    reflexion: 'Reflexion: double-check geofence claims.',
    feedback: 'Feedback: owner liked the concise brief.',
    activeGoals: 'Goal: close monthly royalty before the 7th.',
    grounding: 'grounding: royalty_rate = 6% (corpus)',
    learnedSkills: 'Skill: maintenance.triage.',
    cohortMix: 'Cohort: pilot.',
  };

  it('GOLDEN MASTER — segment concatenation is byte-identical to the string assembler', () => {
    const blocks = assembleSystemPromptBlocks(fullFragments);
    const fromBlocks = blocks.map((s) => s.text).join('\n');
    const fromString = assembleSystemPrompt(fullFragments);
    expect(fromBlocks).toBe(fromString);
  });

  it('GOLDEN MASTER holds for a custom joiner too', () => {
    const joiner = '\n\n';
    const blocks = assembleSystemPromptBlocks(fullFragments, { joiner });
    const fromBlocks = blocks.map((s) => s.text).join(joiner);
    const fromString = assembleSystemPrompt(fullFragments, { joiner });
    expect(fromBlocks).toBe(fromString);
  });

  it('emits exactly ONE cache-breakpoint segment — the stable prefix', () => {
    const blocks = assembleSystemPromptBlocks(fullFragments);
    const breakpoints = blocks.filter((s) => s.cacheBreakpoint);
    expect(breakpoints).toHaveLength(1);
    const prefix = breakpoints[0]!;
    // The stable prefix contains persona + identity + rollout + module inventory.
    expect(prefix.text).toContain('Mr. Mwikila');
    expect(prefix.text).toContain('owner cockpit');
    expect(prefix.text).toContain('cohort-A');
    expect(prefix.text).toContain('Modules:');
    // It must NOT contain any per-turn / per-tenant content.
    expect(prefix.text).not.toContain('royalty_rate');
    expect(prefix.text).not.toContain('Recalled:');
    expect(prefix.text).not.toContain('Recent self-critiques');
  });

  it('the breakpoint segment precedes all dynamic + security segments', () => {
    const blocks = assembleSystemPromptBlocks(fullFragments);
    const breakpointIdx = blocks.findIndex((s) => s.cacheBreakpoint);
    expect(breakpointIdx).toBe(0);
    // Everything after the breakpoint is either dynamic or security, never cached.
    for (let i = breakpointIdx + 1; i < blocks.length; i += 1) {
      expect(blocks[i]!.cacheBreakpoint).toBe(false);
    }
  });

  it('the two security layers are the LAST segments and never carry the breakpoint', () => {
    const blocks = assembleSystemPromptBlocks(fullFragments);
    const last = blocks[blocks.length - 1]!;
    const penultimate = blocks[blocks.length - 2]!;
    expect(last.security).toBe(true);
    expect(last.text).toBe(SECURITY_BOUNDARY_LAYER);
    expect(penultimate.security).toBe(true);
    expect(penultimate.text).toBe(IP_PROTECTION_LAYER);
    expect(last.cacheBreakpoint).toBe(false);
    expect(penultimate.cacheBreakpoint).toBe(false);
  });

  it('the STABLE PREFIX is byte-identical across two turns with different dynamic content (cache-eligible)', () => {
    const turn1: SystemFragments = {
      ...fullFragments,
      grounding: 'grounding: royalty_rate = 6% (corpus)',
      semanticMemory: 'Recalled: prefers TZS.',
    };
    const turn2: SystemFragments = {
      ...fullFragments,
      grounding: 'grounding: fx_rate = 2550 (corpus)',
      semanticMemory: 'Recalled: prefers USD breakdown.',
    };
    const prefix1 = assembleSystemPromptBlocks(turn1).find((s) => s.cacheBreakpoint)!;
    const prefix2 = assembleSystemPromptBlocks(turn2).find((s) => s.cacheBreakpoint)!;
    // Same persona + tenant-agnostic prefix → cache hit on turn 2.
    expect(prefix1.text).toBe(prefix2.text);
    // ...but the dynamic content genuinely differs (proves the prefix is the
    // *only* cacheable part, not the whole prompt).
    const dyn1 = assembleSystemPromptBlocks(turn1).find(
      (s) => !s.cacheBreakpoint && !s.security,
    )!;
    const dyn2 = assembleSystemPromptBlocks(turn2).find(
      (s) => !s.cacheBreakpoint && !s.security,
    )!;
    expect(dyn1.text).not.toBe(dyn2.text);
  });

  it('drops empty groups without emitting a stray segment (no shifted bytes)', () => {
    // Only persona present → stable prefix + security; no dynamic segment.
    const blocks = assembleSystemPromptBlocks({ personaPrelude: 'P' });
    const dynamicSegs = blocks.filter((s) => !s.cacheBreakpoint && !s.security);
    expect(dynamicSegs).toHaveLength(0);
    expect(blocks.map((s) => s.text).join('\n')).toBe(
      assembleSystemPrompt({ personaPrelude: 'P' }),
    );
  });

  it('honours includeSecurityLayers:false (no security segments, breakpoint preserved)', () => {
    const blocks = assembleSystemPromptBlocks(fullFragments, {
      includeSecurityLayers: false,
    });
    expect(blocks.some((s) => s.security)).toBe(false);
    expect(blocks.filter((s) => s.cacheBreakpoint)).toHaveLength(1);
    expect(blocks.map((s) => s.text).join('\n')).toBe(
      assembleSystemPrompt(fullFragments, { includeSecurityLayers: false }),
    );
  });

  it('never mutates the input fragment record', () => {
    const input: SystemFragments = { ...fullFragments };
    const snapshot = JSON.stringify(input);
    assembleSystemPromptBlocks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
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
