/**
 * tracer-pii — A2b-3 wire #1 — asserts `setUserContext` never tags a
 * span with the raw email address. The hashed form is short, salt-keyed,
 * and reveals neither the local-part nor the domain to anyone who can
 * read the trace store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';

import { setUserContext, hashUserEmailForSpan } from '../tracer.js';
import { SpanAttributes } from '../../types/telemetry.types.js';

describe('hashUserEmailForSpan (pure)', () => {
  it('returns a 16-hex-char salted hash when salt is set', () => {
    const out = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper',
    });
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for the same (email, salt) pair', () => {
    const a = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper',
    });
    const b = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper',
    });
    expect(a).toBe(b);
  });

  it('changes when the salt changes (no cross-env correlation)', () => {
    const a = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper-1',
    });
    const b = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper-2',
    });
    expect(a).not.toBe(b);
  });

  it('falls back to <email:redacted> when salt is empty in dev', () => {
    const out = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: '',
      NODE_ENV: 'development',
    });
    expect(out).toBe('<email:redacted>');
  });

  it('throws when salt is empty in production', () => {
    expect(() =>
      hashUserEmailForSpan('alice@example.com', {
        USER_HASH_SALT: '',
        NODE_ENV: 'production',
      }),
    ).toThrow(/USER_HASH_SALT/);
  });

  it('never embeds the plaintext local-part or domain', () => {
    const out = hashUserEmailForSpan('alice@example.com', {
      USER_HASH_SALT: 'pepper',
    });
    expect(out).not.toContain('alice');
    expect(out).not.toContain('@');
    expect(out).not.toContain('example.com');
  });
});

describe('setUserContext — OTel span integration', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    process.env.USER_HASH_SALT = 'unit-test-salt';
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    process.env = { ...ORIGINAL_ENV };
  });

  const findSpan = (name: string): ReadableSpan | undefined =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  it('hashes the email attribute on the active span', () => {
    const tracer = provider.getTracer('pii-test');
    const span = tracer.startSpan('http.request');
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => {
      setUserContext('u_1', 'alice@example.com');
    });
    span.end();

    const recorded = findSpan('http.request');
    expect(recorded).toBeDefined();
    const emailAttr = recorded!.attributes[SpanAttributes.USER_EMAIL];
    expect(typeof emailAttr).toBe('string');
    // Must NOT contain any segment of the plaintext email.
    expect(String(emailAttr)).not.toContain('alice');
    expect(String(emailAttr)).not.toContain('@example.com');
    expect(String(emailAttr)).not.toContain('example.com');
    // Should be the 16-hex hash form for this salt.
    expect(String(emailAttr)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stamps user_id verbatim alongside the hashed email', () => {
    const tracer = provider.getTracer('pii-test');
    const span = tracer.startSpan('http.request2');
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => {
      setUserContext('u_42', 'bob@example.org', ['ADMIN']);
    });
    span.end();

    const recorded = findSpan('http.request2');
    expect(recorded!.attributes[SpanAttributes.USER_ID]).toBe('u_42');
    expect(recorded!.attributes[SpanAttributes.USER_ROLES]).toBe('ADMIN');
    expect(String(recorded!.attributes[SpanAttributes.USER_EMAIL])).not.toContain(
      'bob',
    );
  });
});
