/**
 * Tests for the Langfuse OTel adapter (D6).
 *
 * Locks in:
 *   - kind → langfuse.observation.type mapping
 *   - attribute key shape (`langfuse.trace.name`,
 *     `langfuse.observation.type`, `langfuse.observation.metadata.*`,
 *     `langfuse.observation.usage_details`, …)
 *   - opt-in env behaviour (LANGFUSE_HOST / LANGFUSE_BASEURL)
 *   - lazy-import returns `{ available: false }` when the package is
 *     absent, rather than throwing
 *   - emitLangfuseSpan integrates with a real in-memory OTel tracer
 *     pipeline and produces a span carrying the expected attributes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

import {
  buildLangfuseSpanAttributes,
  mapLangfuseObservationType,
  emitLangfuseSpan,
} from '../tracer.js';
import {
  isLangfuseEnabled,
  loadLangfuseClient,
  withLangfuseGeneration,
  withLangfuseSpan,
} from '../langfuse-adapter.js';

// ---------------------------------------------------------------------------
// Pure attribute-shape tests — no OTel pipeline required.
// ---------------------------------------------------------------------------

describe('mapLangfuseObservationType', () => {
  it('maps generation → "generation"', () => {
    expect(mapLangfuseObservationType('generation')).toBe('generation');
  });

  it('collapses tool-call / retrieval / span → "span"', () => {
    expect(mapLangfuseObservationType('tool-call')).toBe('span');
    expect(mapLangfuseObservationType('retrieval')).toBe('span');
    expect(mapLangfuseObservationType('span')).toBe('span');
  });
});

describe('buildLangfuseSpanAttributes', () => {
  it('emits the Langfuse-recognised observation.type key', () => {
    const attrs = buildLangfuseSpanAttributes('generation', {});
    expect(attrs['langfuse.observation.type']).toBe('generation');
  });

  it('preserves borjie_kind metadata for non-span kinds', () => {
    const tool = buildLangfuseSpanAttributes('tool-call', {});
    expect(tool['langfuse.observation.metadata.borjie_kind']).toBe(
      'tool-call',
    );
    const retrieval = buildLangfuseSpanAttributes('retrieval', {});
    expect(retrieval['langfuse.observation.metadata.borjie_kind']).toBe(
      'retrieval',
    );
  });

  it('does NOT tag borjie_kind for the generic span kind', () => {
    const attrs = buildLangfuseSpanAttributes('span', {});
    expect(
      attrs['langfuse.observation.metadata.borjie_kind'],
    ).toBeUndefined();
  });

  it('stamps user/session/environment when provided', () => {
    const attrs = buildLangfuseSpanAttributes('span', {
      userId: 'user-42',
      sessionId: 'sess-7',
      environment: 'staging',
    });
    expect(attrs['langfuse.user.id']).toBe('user-42');
    expect(attrs['langfuse.session.id']).toBe('sess-7');
    expect(attrs['langfuse.environment']).toBe('staging');
  });

  it('serialises usage details as a JSON string', () => {
    const attrs = buildLangfuseSpanAttributes('generation', {
      modelName: 'claude-opus-4-7',
      usage: { input: 120, output: 60 },
    });
    expect(attrs['langfuse.observation.model.name']).toBe('claude-opus-4-7');
    expect(typeof attrs['langfuse.observation.usage_details']).toBe('string');
    expect(
      JSON.parse(attrs['langfuse.observation.usage_details'] as string),
    ).toEqual({ input: 120, output: 60 });
  });

  it('flattens metadata under the langfuse.observation.metadata.* prefix', () => {
    const attrs = buildLangfuseSpanAttributes('span', {
      metadata: { tenant: 'tenant-a', score: 0.91, ok: true },
    });
    expect(attrs['langfuse.observation.metadata.tenant']).toBe('tenant-a');
    expect(attrs['langfuse.observation.metadata.score']).toBe(0.91);
    expect(attrs['langfuse.observation.metadata.ok']).toBe(true);
  });

  it('passes raw attributes through unchanged', () => {
    const attrs = buildLangfuseSpanAttributes('span', {
      raw: { 'http.status_code': 200 },
    });
    expect(attrs['http.status_code']).toBe(200);
  });

  it('exposes severity via langfuse.observation.level', () => {
    const attrs = buildLangfuseSpanAttributes('span', { level: 'WARNING' });
    expect(attrs['langfuse.observation.level']).toBe('WARNING');
  });

  it('omits optional keys when not provided', () => {
    const attrs = buildLangfuseSpanAttributes('span', {});
    // Only the type key is required.
    expect(Object.keys(attrs)).toEqual(['langfuse.observation.type']);
  });
});

// ---------------------------------------------------------------------------
// Opt-in env behaviour + lazy SDK loader.
// ---------------------------------------------------------------------------

describe('isLangfuseEnabled', () => {
  it('returns false when no host env vars are set', () => {
    expect(isLangfuseEnabled({})).toBe(false);
  });

  it('returns true on LANGFUSE_HOST', () => {
    expect(isLangfuseEnabled({ LANGFUSE_HOST: 'https://lf.example' })).toBe(
      true,
    );
  });

  it('returns true on LANGFUSE_BASEURL (legacy)', () => {
    expect(
      isLangfuseEnabled({ LANGFUSE_BASEURL: 'https://lf.example' }),
    ).toBe(true);
  });
});

describe('loadLangfuseClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('short-circuits to { available: false } when no host env is set', async () => {
    delete process.env.LANGFUSE_HOST;
    delete process.env.LANGFUSE_BASEURL;
    const result = await loadLangfuseClient();
    expect(result.available).toBe(false);
    expect(result.mod).toBeNull();
    expect(result.reason).toContain('LANGFUSE_HOST');
  });

  it('reports SDK absence without throwing when env is set but package missing', async () => {
    process.env.LANGFUSE_HOST = 'https://lf.example';
    const result = await loadLangfuseClient();
    // In the test environment the `langfuse` package is intentionally
    // NOT installed (it's an optionalDependency). Loader must therefore
    // surface `available: false` with a diagnostic — never throw.
    expect(result.available).toBe(false);
    expect(result.mod).toBeNull();
    expect(typeof result.reason).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Integration: emitLangfuseSpan + a real in-memory OTel pipeline.
// ---------------------------------------------------------------------------

describe('emitLangfuseSpan — OTel pipeline integration', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  const findSpan = (name: string): ReadableSpan | undefined =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  it('emits a span carrying the Langfuse-recognised attribute keys', async () => {
    const tracer = provider.getTracer('test');
    await emitLangfuseSpan(
      tracer,
      'llm.generate.draft',
      'generation',
      {
        modelName: 'claude-opus-4-7',
        userId: 'user-1',
        sessionId: 'sess-1',
        environment: 'test',
        usage: { input: 10, output: 5 },
      },
      async () => 'ok',
    );
    const span = findSpan('llm.generate.draft');
    expect(span).toBeDefined();
    expect(span!.attributes['langfuse.observation.type']).toBe('generation');
    expect(span!.attributes['langfuse.observation.model.name']).toBe(
      'claude-opus-4-7',
    );
    expect(span!.attributes['langfuse.trace.name']).toBe('llm.generate.draft');
    expect(span!.attributes['langfuse.user.id']).toBe('user-1');
    expect(span!.attributes['langfuse.session.id']).toBe('sess-1');
    expect(span!.attributes['langfuse.environment']).toBe('test');
    expect(
      JSON.parse(
        span!.attributes['langfuse.observation.usage_details'] as string,
      ),
    ).toEqual({ input: 10, output: 5 });
  });

  it('records exceptions and marks span status ERROR on throw', async () => {
    const tracer = provider.getTracer('test');
    await expect(
      emitLangfuseSpan(
        tracer,
        'llm.generate.fail',
        'generation',
        { modelName: 'm' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
    const span = findSpan('llm.generate.fail');
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('honours explicit traceName overriding the span name', async () => {
    const tracer = provider.getTracer('test');
    await emitLangfuseSpan(
      tracer,
      'low-level.call',
      'tool-call',
      { traceName: 'business.rent.collect' },
      async () => undefined,
    );
    const span = findSpan('low-level.call');
    expect(span!.attributes['langfuse.trace.name']).toBe(
      'business.rent.collect',
    );
    expect(span!.attributes['langfuse.observation.type']).toBe('span');
    expect(span!.attributes['langfuse.observation.metadata.borjie_kind']).toBe(
      'tool-call',
    );
  });

  it('withLangfuseGeneration is a thin alias over emitLangfuseSpan', async () => {
    const tracer = provider.getTracer('test');
    await withLangfuseGeneration(
      tracer,
      'gen.alias',
      { modelName: 'm-1' },
      async () => undefined,
    );
    const span = findSpan('gen.alias');
    expect(span!.attributes['langfuse.observation.type']).toBe('generation');
    expect(span!.attributes['langfuse.observation.model.name']).toBe('m-1');
  });

  it('withLangfuseSpan accepts the retrieval kind and stamps metadata', async () => {
    const tracer = provider.getTracer('test');
    await withLangfuseSpan(
      tracer,
      'retrieve.docs',
      'retrieval',
      { metadata: { source: 'pg-vector', topK: 8 } },
      async () => undefined,
    );
    const span = findSpan('retrieve.docs');
    expect(span!.attributes['langfuse.observation.type']).toBe('span');
    expect(span!.attributes['langfuse.observation.metadata.borjie_kind']).toBe(
      'retrieval',
    );
    expect(span!.attributes['langfuse.observation.metadata.source']).toBe(
      'pg-vector',
    );
    expect(span!.attributes['langfuse.observation.metadata.topK']).toBe(8);
  });
});
