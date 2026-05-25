import { describe, expect, it } from 'vitest';
import {
  resolveInputs,
  resolvePlaceholders,
  runCompoundTool,
  type CompoundToolDef,
  type RegistryEntry,
} from '../tool-decomposition.js';

describe('tool-decomposition: placeholder resolution', () => {
  it('resolves single placeholder', () => {
    const ctx = new Map([['x', '42']]);
    expect(resolvePlaceholders('val is {$x}', ctx)).toBe('val is 42');
  });

  it('keeps unknown placeholder literal', () => {
    expect(resolvePlaceholders('val is {$missing}', new Map())).toBe('val is {$missing}');
  });

  it('resolves multiple placeholders', () => {
    const ctx = new Map([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(resolvePlaceholders('{$a}+{$b}', ctx)).toBe('1+2');
  });

  it('resolveInputs maps over object', () => {
    const ctx = new Map([['who', 'alice']]);
    const out = resolveInputs({ greeting: 'hi {$who}', extra: 'static' }, ctx);
    expect(out.greeting).toBe('hi alice');
    expect(out.extra).toBe('static');
  });
});

describe('tool-decomposition: compound runner', () => {
  const registry: Map<string, RegistryEntry> = new Map();
  registry.set('echo', {
    def: { name: 'echo', description: 'returns input.text', inputSchema: {} },
    run: async (input) => input.text ?? '',
  });
  registry.set('upper', {
    def: { name: 'upper', description: 'uppercases input.text', inputSchema: {} },
    run: async (input) => (input.text ?? '').toUpperCase(),
  });
  registry.set('boom', {
    def: { name: 'boom', description: 'always throws', inputSchema: {} },
    run: async () => {
      throw new Error('kaboom');
    },
  });

  it('runs simple two-step chain', async () => {
    const def: CompoundToolDef = {
      name: 'chain',
      description: 'echo then upper',
      steps: [
        {
          toolName: 'echo',
          inputTemplate: { text: 'hello' },
          outputKey: 'first',
        },
        {
          toolName: 'upper',
          inputTemplate: { text: '{$first}' },
          outputKey: 'second',
        },
      ],
    };
    const out = await runCompoundTool(def, registry);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.context.bindings.get('second')).toBe('HELLO');
      expect(out.context.stepResults.length).toBe(2);
    }
  });

  it('errors on unknown tool', async () => {
    const def: CompoundToolDef = {
      name: 'bad',
      description: 'x',
      steps: [{ toolName: 'doesNotExist', inputTemplate: {} }],
    };
    const out = await runCompoundTool(def, registry);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('unknown-tool');
  });

  it('errors on thrown step', async () => {
    const def: CompoundToolDef = {
      name: 'failing',
      description: 'x',
      steps: [{ toolName: 'boom', inputTemplate: {} }],
    };
    const out = await runCompoundTool(def, registry);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('step-0-failed');
  });

  it('respects initial bindings', async () => {
    const def: CompoundToolDef = {
      name: 'x',
      description: 'x',
      steps: [{ toolName: 'echo', inputTemplate: { text: '{$preset}' }, outputKey: 'r' }],
    };
    const out = await runCompoundTool(def, registry, new Map([['preset', 'hi']]));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.context.bindings.get('r')).toBe('hi');
  });

  it('preserves bindings through steps', async () => {
    const def: CompoundToolDef = {
      name: 'x',
      description: 'x',
      steps: [
        { toolName: 'echo', inputTemplate: { text: 'a' }, outputKey: 'first' },
        { toolName: 'echo', inputTemplate: { text: '{$first}-b' }, outputKey: 'second' },
        { toolName: 'echo', inputTemplate: { text: '{$first}-{$second}' }, outputKey: 'third' },
      ],
    };
    const out = await runCompoundTool(def, registry);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.context.bindings.get('third')).toBe('a-a-b');
    }
  });

  it('does not bind when outputKey omitted', async () => {
    const def: CompoundToolDef = {
      name: 'x',
      description: 'x',
      steps: [{ toolName: 'echo', inputTemplate: { text: 'a' } }],
    };
    const out = await runCompoundTool(def, registry);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.context.bindings.size).toBe(0);
    }
  });
});
