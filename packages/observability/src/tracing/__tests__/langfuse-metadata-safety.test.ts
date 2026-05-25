/**
 * A2b-3 wire #2 — Langfuse metadata safety net.
 *
 * Forbids `userMessage` / `prompt` / `response` / `chatText` / `cot` /
 * `thoughtText` from ever appearing in a Langfuse-conventioned span at
 * both:
 *   1. Compile time — `SafeLangfuseMetadata` excludes these keys at the
 *      type level (locked in via the ts-expect-error blocks below).
 *   2. Runtime — `scrubForbiddenMetadata` drops the offending key and
 *      emits a `console.warn` so the trace still ships.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import {
  scrubForbiddenMetadata,
  withLangfuseGeneration,
  withLangfuseSpan,
  FORBIDDEN_METADATA_KEYS,
  type SafeLangfuseMetadata,
} from '../langfuse-adapter.js';

describe('scrubForbiddenMetadata', () => {
  it('returns undefined when input is undefined', () => {
    expect(scrubForbiddenMetadata(undefined)).toBeUndefined();
  });

  it('passes through safe metadata unchanged', () => {
    const safe = { tenantId: 't1', score: 0.91 };
    const out = scrubForbiddenMetadata(safe);
    expect(out).toEqual(safe);
  });

  it('drops every forbidden key', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dirty = {
      userMessage: 'hi alice',
      prompt: 'system prompt…',
      response: 'model said…',
      chatText: '…',
      cot: 'scratchpad',
      thoughtText: 'inner monologue',
      keepMe: 'fine',
    };
    const out = scrubForbiddenMetadata(dirty)!;
    for (const k of FORBIDDEN_METADATA_KEYS) {
      expect(out[k]).toBeUndefined();
    }
    expect(out.keepMe).toBe('fine');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not mutate the caller payload', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dirty = { userMessage: 'leak', ok: 1 };
    scrubForbiddenMetadata(dirty);
    expect(dirty.userMessage).toBe('leak');
    spy.mockRestore();
  });
});

describe('Safe metadata — compile-time guard', () => {
  it('accepts safe keys at the type level', () => {
    const ok: SafeLangfuseMetadata = { tenantId: 't', tokens: 12 };
    expect(ok).toBeDefined();
  });

  it('rejects forbidden keys at the type level', () => {
    // The ts-expect-error directives below are the actual lock-in: if
    // the type ever permits these keys, the build fails. The runtime
    // expect() is incidental — the load-bearing assertion is the
    // directive itself.

    // @ts-expect-error userMessage forbidden by SafeLangfuseMetadata
    const bad1: SafeLangfuseMetadata = { userMessage: 'x' };
    // @ts-expect-error prompt forbidden
    const bad2: SafeLangfuseMetadata = { prompt: 'x' };
    // @ts-expect-error response forbidden
    const bad3: SafeLangfuseMetadata = { response: 'x' };
    // @ts-expect-error chatText forbidden
    const bad4: SafeLangfuseMetadata = { chatText: 'x' };
    // @ts-expect-error cot forbidden
    const bad5: SafeLangfuseMetadata = { cot: 'x' };
    // @ts-expect-error thoughtText forbidden
    const bad6: SafeLangfuseMetadata = { thoughtText: 'x' };
    expect([bad1, bad2, bad3, bad4, bad5, bad6]).toBeDefined();
  });
});

describe('withLangfuseGeneration — runtime scrub via OTel pipeline', () => {
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

  it('drops userMessage at runtime and emits a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tracer = provider.getTracer('safety-test');
    await withLangfuseGeneration(
      tracer,
      'llm.gen',
      {
        modelName: 'm-1',
        // Widen past the type system on purpose to exercise the runtime guard.
        metadata: { userMessage: 'PII leak', tenantId: 't1' } as unknown as SafeLangfuseMetadata,
      },
      async () => undefined,
    );
    const span = exporter.getFinishedSpans().find((s) => s.name === 'llm.gen');
    expect(span).toBeDefined();
    // The scrub erased `userMessage` from the metadata bag, so the
    // flattened span attribute should NOT carry it.
    expect(
      span!.attributes['langfuse.observation.metadata.userMessage'],
    ).toBeUndefined();
    expect(
      span!.attributes['langfuse.observation.metadata.tenantId'],
    ).toBe('t1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops cot via withLangfuseSpan too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tracer = provider.getTracer('safety-test');
    await withLangfuseSpan(
      tracer,
      'agent.step',
      'tool-call',
      {
        metadata: { cot: 'inner', score: 0.5 } as unknown as SafeLangfuseMetadata,
      },
      async () => undefined,
    );
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'agent.step');
    expect(
      span!.attributes['langfuse.observation.metadata.cot'],
    ).toBeUndefined();
    expect(
      span!.attributes['langfuse.observation.metadata.score'],
    ).toBe(0.5);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
