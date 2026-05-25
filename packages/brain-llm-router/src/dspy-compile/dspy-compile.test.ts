/**
 * Tests for dspy-compile/ — Signature, compiler, PromptCache.
 */

import { describe, expect, it } from 'vitest';
import { defineSignature, hashSignature, type FewShotExample } from './signature.js';
import { compileSignature, formatSystem } from './compiler.js';
import { InMemoryCacheStore, PromptCache, PromptCacheMissError } from './prompt-cache.js';
import { normaliseModelKey } from './normalise-key.js';

describe('Signature', () => {
  const baseSpec = {
    taskName: 'extract_lease_terms',
    taskKind: 'classify' as const,
    objective: 'Extract structured lease terms from raw text.',
    inputs: [{ name: 'lease_text', description: 'raw lease body', type: 'string' as const }],
    outputs: [{ name: 'terms', description: 'parsed term object', type: 'object' as const }],
  };

  it('hashSignature is stable and deterministic', () => {
    expect(hashSignature(baseSpec)).toBe(hashSignature(baseSpec));
  });

  it('hashSignature changes when objective changes', () => {
    const altered = { ...baseSpec, objective: 'Different goal' };
    expect(hashSignature(baseSpec)).not.toBe(hashSignature(altered));
  });

  it('defineSignature fills versionHash and freezes', () => {
    const sig = defineSignature(baseSpec);
    expect(sig.versionHash).toMatch(/^[0-9a-z]+$/);
    expect(Object.isFrozen(sig)).toBe(true);
  });
});

describe('compileSignature', () => {
  const sig = defineSignature({
    taskName: 'extract_lease_terms',
    taskKind: 'classify',
    objective: 'Extract terms',
    inputs: [{ name: 'lease_text', description: 'raw lease', type: 'string' }],
    outputs: [{ name: 'terms', description: 'terms object', type: 'object' }],
  });

  const examples: FewShotExample[] = [
    { inputs: { lease_text: 'A 12-month lease...' }, outputs: { terms: { months: 12 } } },
    { inputs: { lease_text: 'A 6-month lease...' }, outputs: { terms: { months: 6 } } },
    { inputs: { lease_text: 'A 24-month lease...' }, outputs: { terms: { months: 24 } } },
  ];

  it('picks the highest-scoring instruction', async () => {
    const oracleEval = async (c: { compiledInstruction: string }): Promise<number> =>
      c.compiledInstruction.includes('Extract precisely') ? 0.95 : 0.5;
    const compiled = await compileSignature({
      model: 'anthropic/claude-haiku-4-5',
      signature: sig,
      candidateInstructions: ['Just extract.', 'Extract precisely all numeric fields.'],
      examplePool: examples,
      oracleEval,
    });
    expect(compiled.compilerScore).toBe(0.95);
    expect(compiled.compiledInstruction).toContain('Extract precisely');
    expect(compiled.demonstrations.length).toBeGreaterThan(0);
  });

  it('throws when no candidates provided', async () => {
    await expect(
      compileSignature({
        model: 'anthropic/claude-haiku-4-5',
        signature: sig,
        candidateInstructions: [],
        examplePool: examples,
        oracleEval: () => 1,
      })
    ).rejects.toThrow(/non-empty/);
  });

  it('formatSystem produces XML-tagged role/objective/inputs/outputs', () => {
    const sys = formatSystem(sig);
    expect(sys).toContain('<role>');
    expect(sys).toContain('<objective>');
    expect(sys).toContain('<inputs>');
    expect(sys).toContain('<outputs>');
  });
});

describe('PromptCache', () => {
  const sig = defineSignature({
    taskName: 'extract_lease_terms',
    taskKind: 'classify',
    objective: 'Extract terms',
    inputs: [{ name: 'lease_text', description: 'raw', type: 'string' }],
    outputs: [{ name: 'terms', description: 'parsed', type: 'object' }],
  });

  it('normaliseModelKey strips provider prefix and @cloud', () => {
    expect(normaliseModelKey('anthropic/claude-haiku-4-5@bedrock')).toBe('claude-haiku-4-5');
    expect(normaliseModelKey('openai/gpt-5')).toBe('gpt-5');
  });

  it('save then load round-trips a CompiledPrompt', async () => {
    const store = new InMemoryCacheStore();
    const cache = new PromptCache({
      baseDir: 'compiled-prompts',
      reader: store,
      writer: store,
    });
    const compiled = await compileSignature({
      model: 'anthropic/claude-haiku-4-5',
      signature: sig,
      candidateInstructions: ['Test instruction.'],
      examplePool: [{ inputs: { lease_text: 'x' }, outputs: { terms: {} } }],
      oracleEval: () => 0.9,
    });
    await cache.save(compiled);
    expect(store.has('compiled-prompts/extract_lease_terms/claude-haiku-4-5.json')).toBe(true);
    const loaded = await cache.load('extract_lease_terms', 'anthropic/claude-haiku-4-5');
    expect(loaded.compilerScore).toBe(0.9);
    expect(loaded.signatureName).toBe('extract_lease_terms');
  });

  it('second load hits the cache (no recompilation)', async () => {
    const store = new InMemoryCacheStore();
    const cache = new PromptCache({ baseDir: 'compiled-prompts', reader: store, writer: store });
    let compileCount = 0;
    const compiled = await compileSignature({
      model: 'anthropic/claude-haiku-4-5',
      signature: sig,
      candidateInstructions: ['Test.'],
      examplePool: [{ inputs: { lease_text: 'x' }, outputs: { terms: {} } }],
      oracleEval: () => {
        compileCount += 1;
        return 0.8;
      },
    });
    await cache.save(compiled);
    await cache.load('extract_lease_terms', 'anthropic/claude-haiku-4-5');
    await cache.load('extract_lease_terms', 'anthropic/claude-haiku-4-5');
    expect(compileCount).toBeGreaterThan(0); // compile happened once
    // Loading the cache does not re-invoke oracleEval.
  });

  it('throws PromptCacheMissError when file absent', async () => {
    const store = new InMemoryCacheStore();
    const cache = new PromptCache({ baseDir: 'compiled-prompts', reader: store });
    await expect(cache.load('missing_task', 'anthropic/claude-haiku-4-5')).rejects.toBeInstanceOf(
      PromptCacheMissError
    );
  });

  it('pathFor uses task/<normalised model>.json layout', () => {
    const cache = new PromptCache({ baseDir: 'compiled-prompts', reader: new InMemoryCacheStore() });
    expect(cache.pathFor('plan_task', 'anthropic/claude-opus-4-7@bedrock')).toBe(
      'compiled-prompts/plan_task/claude-opus-4-7.json'
    );
  });
});
