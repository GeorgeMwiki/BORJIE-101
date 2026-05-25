import { describe, expect, it } from 'vitest';
import {
  canonicalLog,
  enrich,
  redactFields,
} from '../log-field-conventions.js';
import type { CorrelationId, TenantId, TraceId } from '../types.js';

describe('log-field-conventions: canonicalLog', () => {
  it('fills tsMs default', () => {
    const log = canonicalLog({
      level: 'info',
      message: 'hello',
      service: 'api',
      env: 'test',
    });
    expect(log.tsMs).toBeGreaterThan(0);
    expect(log.fields).toEqual({});
  });

  it('preserves explicit tsMs', () => {
    const log = canonicalLog({
      level: 'info',
      message: 'hello',
      service: 'api',
      env: 'test',
      tsMs: 42,
    });
    expect(log.tsMs).toBe(42);
  });

  it('preserves passed fields', () => {
    const log = canonicalLog({
      level: 'warn',
      message: 'm',
      service: 'api',
      env: 'test',
      fields: { route: '/x' },
    });
    expect(log.fields.route).toBe('/x');
  });
});

describe('log-field-conventions: redactFields', () => {
  it('redacts known sensitive keys', () => {
    const out = redactFields({ password: 'pw', other: 1 });
    expect(out.password).toBe('[REDACTED]');
    expect(out.other).toBe(1);
  });

  it('redacts case-insensitively', () => {
    const out = redactFields({ PassWord: 'pw' });
    expect(out.PassWord).toBe('[REDACTED]');
  });

  it('redacts nested objects', () => {
    const out = redactFields({
      headers: { authorization: 'Bearer xyz', accept: 'json' },
    }) as { headers: { authorization: string; accept: string } };
    expect(out.headers.authorization).toBe('[REDACTED]');
    expect(out.headers.accept).toBe('json');
  });

  it('uses custom placeholder', () => {
    const out = redactFields({ token: 't' }, { placeholder: '***' });
    expect(out.token).toBe('***');
  });

  it('uses custom key list', () => {
    const out = redactFields({ ssn: 'x', myKey: 'y' }, { keys: ['myKey'] });
    expect(out.ssn).toBe('x');
    expect(out.myKey).toBe('[REDACTED]');
  });

  it('does not mutate input', () => {
    const input = { password: 'pw' };
    redactFields(input);
    expect(input.password).toBe('pw');
  });
});

describe('log-field-conventions: enrich', () => {
  it('fills missing context fields', () => {
    const log = canonicalLog({ level: 'info', message: 'x', service: 'api', env: 'test' });
    const enriched = enrich(log, {
      tenantId: 't1' as TenantId,
      correlationId: 'c1' as CorrelationId,
      traceId: 'trace' as TraceId,
    });
    expect(enriched.tenantId).toBe('t1');
    expect(enriched.correlationId).toBe('c1');
    expect(enriched.traceId).toBe('trace');
  });

  it('does not overwrite present fields', () => {
    const log = canonicalLog({
      level: 'info',
      message: 'x',
      service: 'api',
      env: 'test',
      tenantId: 't0' as TenantId,
    });
    const enriched = enrich(log, { tenantId: 't1' as TenantId });
    expect(enriched.tenantId).toBe('t0');
  });

  it('handles empty context', () => {
    const log = canonicalLog({ level: 'info', message: 'x', service: 'api', env: 'test' });
    const enriched = enrich(log, {});
    expect(enriched).toBeTruthy();
  });
});
