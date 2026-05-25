import { describe, expect, it } from 'vitest';
import {
  McpToolRegistry,
  rankCandidates,
  tokenize,
  extractMinimalSchema,
  DEFAULT_DEFER_THRESHOLD,
} from '../index.js';
import type { McpToolDescriptor } from '../index.js';

function mkTool(name: string, description: string, tags?: string[]): McpToolDescriptor {
  return {
    name,
    description,
    tags,
    full_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        amount: { type: 'number' },
        memo: { type: 'string' },
      },
      required: ['phone', 'amount'],
    },
  };
}

function makeServer(prefix: string, count: number): ReadonlyArray<McpToolDescriptor> {
  return Array.from({ length: count }, (_, i) =>
    mkTool(`${prefix}__tool_${i}`, `${prefix} tool number ${i}`, [prefix, `tag_${i}`])
  );
}

describe('tokenize', () => {
  it('splits on non-alphanumeric', () => {
    expect(tokenize('mpesa.send (KE)!')).toEqual(['mpesa', 'send', 'ke']);
  });

  it('drops stopwords', () => {
    expect(tokenize('send the money to me')).toEqual(['send', 'money']);
  });
});

describe('extractMinimalSchema', () => {
  it('extracts top-level property keys + types + required flag', () => {
    const ms = extractMinimalSchema({
      type: 'object',
      properties: { foo: { type: 'string' }, bar: { type: 'number' } },
      required: ['foo'],
    });
    expect(ms).toContainEqual({ key: 'foo', type: 'string', required: true });
    expect(ms).toContainEqual({ key: 'bar', type: 'number', required: false });
  });

  it('returns [] when properties is absent', () => {
    expect(extractMinimalSchema({ type: 'object' })).toEqual([]);
  });
});

describe('rankCandidates', () => {
  it('returns empty when no overlap', () => {
    const r = rankCandidates([mkTool('a__foo', 'foo description')], 'totally unrelated', 5);
    expect(r).toEqual([]);
  });

  it('ranks name match highest', () => {
    const r = rankCandidates(
      [
        mkTool('a__alpha', 'unrelated description'),
        mkTool('a__beta', 'alpha words in description but different name'),
      ],
      'alpha',
      5
    );
    expect(r[0]?.name).toBe('a__alpha');
  });

  it('respects max_results cap', () => {
    const tools = Array.from({ length: 10 }, (_, i) =>
      mkTool(`a__alpha_${i}`, `alpha tool ${i}`)
    );
    const r = rankCandidates(tools, 'alpha', 3);
    expect(r).toHaveLength(3);
  });

  it('includes minimal_schema in results', () => {
    const r = rankCandidates([mkTool('a__alpha', 'alpha description')], 'alpha', 5);
    expect(r[0]?.minimal_schema.length).toBeGreaterThan(0);
  });
});

describe('McpToolRegistry — defer threshold', () => {
  it('inlines small servers below the threshold', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('small', makeServer('small', 5));
    const proj = reg.projectContext();
    expect(proj.inlined).toHaveLength(5);
    expect(proj.deferred).toHaveLength(0);
  });

  it('defers servers at or above the threshold', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('big', makeServer('big', DEFAULT_DEFER_THRESHOLD));
    const proj = reg.projectContext();
    expect(proj.deferred).toEqual([
      { server: 'big', tool_count: DEFAULT_DEFER_THRESHOLD },
    ]);
    expect(proj.inlined).toHaveLength(0);
  });

  it('mixes inline + deferred when both exist', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('small', makeServer('small', 5));
    reg.registerServer('big', makeServer('big', 80));
    const proj = reg.projectContext();
    expect(proj.inlined).toHaveLength(5);
    expect(proj.deferred).toHaveLength(1);
  });

  it('uses custom defer_threshold when provided', () => {
    const reg = new McpToolRegistry({ defer_threshold: 10 });
    reg.registerServer('mid', makeServer('mid', 15));
    expect(reg.projectContext().deferred).toHaveLength(1);
  });

  it('estimates tokens saved by deferral', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('big', makeServer('big', 100));
    expect(reg.projectContext().approx_tokens_saved).toBeGreaterThan(0);
  });
});

describe('McpToolRegistry — search', () => {
  it('returns ranked candidates above zero score', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    const result = reg.search({ query: 'mpesa_tool_3' });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.name).toContain('mpesa');
  });

  it('only searches deferred servers (inlined ones are already in context)', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('inline', makeServer('inline', 5));
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    const result = reg.search({ query: 'inline' });
    // Inline tools are not searched.
    expect(result.candidates.find((c) => c.name.startsWith('inline'))).toBeUndefined();
  });

  it('honours name_filter for exact selection', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    const result = reg.search({
      query: 'tool',
      name_filter: ['mpesa__tool_3'],
    });
    expect(result.candidates.map((c) => c.name)).toEqual(['mpesa__tool_3']);
  });

  it('caps results to max_results (default 5)', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    expect(reg.search({ query: 'mpesa tool' }).candidates.length).toBeLessThanOrEqual(5);
  });

  it('runs under 100ms for thousands of tools', () => {
    const reg = new McpToolRegistry();
    // 5 servers, 1000 tools each = 5000 deferred tools.
    for (let s = 0; s < 5; s++) reg.registerServer(`s${s}`, makeServer(`s${s}`, 1000));
    const result = reg.search({ query: 's2 tool 5' });
    expect(result.elapsed_ms).toBeDefined();
    expect(result.elapsed_ms!).toBeLessThan(100);
  });

  it('reports registry_size in result', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('big', makeServer('big', 60));
    reg.registerServer('small', makeServer('small', 5));
    expect(reg.search({ query: 'x' }).registry_size).toBe(65);
  });

  it('returns empty candidates for a no-match query', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    const r = reg.search({ query: 'completely_unrelated_query' });
    expect(r.candidates).toEqual([]);
  });
});

describe('McpToolRegistry — loadFullSchema', () => {
  it('returns the full schema for a known tool', () => {
    const reg = new McpToolRegistry();
    reg.registerServer('mpesa', makeServer('mpesa', 60));
    const schema = reg.loadFullSchema('mpesa__tool_5');
    expect(schema['type']).toBe('object');
  });

  it('throws for an unknown tool name', () => {
    const reg = new McpToolRegistry();
    expect(() => reg.loadFullSchema('mpesa__missing')).toThrow(/tool not found/);
  });
});
