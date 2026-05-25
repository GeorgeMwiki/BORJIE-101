import { describe, it, expect } from 'vitest';

import {
  redactPII,
  wrapLoggerWithRedaction,
  DEFAULT_PII_FIELDS,
} from '../pii-redactor.js';

describe('redactPII', () => {
  it('redacts top-level PII fields', () => {
    const input = {
      email: 'alice@example.com',
      tenantId: 'tnt_abc',
      action: 'login',
    };
    const out = redactPII(input);
    expect(out.email).toBe('[REDACTED]:email');
    expect(out.tenantId).toBe('tnt_abc');
    expect(out.action).toBe('login');
  });

  it('redacts nested PII fields recursively', () => {
    const input = {
      user: {
        firstName: 'Alice',
        lastName: 'Wonderland',
        address: { street: '123 Rabbit Lane', postalCode: '00100' },
      },
      events: [
        { phone: '+254712345678', timestamp: '2026-05-24' },
        { mpesaNumber: 'MP123', amount: 100 },
      ],
    };
    const out = redactPII(input);
    expect(out.user.firstName).toBe('[REDACTED]:firstName');
    expect(out.user.lastName).toBe('[REDACTED]:lastName');
    expect(out.user.address.street).toBe('[REDACTED]:street');
    expect(out.user.address.postalCode).toBe('[REDACTED]:postalCode');
    expect(out.events[0]?.phone).toBe('[REDACTED]:phone');
    expect(out.events[0]?.timestamp).toBe('2026-05-24');
    expect(out.events[1]?.mpesaNumber).toBe('[REDACTED]:mpesaNumber');
    expect(out.events[1]?.amount).toBe(100);
  });

  it('matches snake_case PII keys', () => {
    const input = { first_name: 'Bob', last_name: 'Smith' };
    const out = redactPII(input) as Record<string, unknown>;
    expect(out['first_name']).toBe('[REDACTED]:first_name');
    expect(out['last_name']).toBe('[REDACTED]:last_name');
  });

  it('never mutates the input', () => {
    const input = { email: 'a@b.com' };
    redactPII(input);
    expect(input.email).toBe('a@b.com');
  });

  it('returns primitives untouched', () => {
    expect(redactPII(42)).toBe(42);
    expect(redactPII('hello')).toBe('hello');
    expect(redactPII(null)).toBe(null);
    expect(redactPII(undefined)).toBe(undefined);
    expect(redactPII(true)).toBe(true);
  });

  it('handles arrays of primitives', () => {
    const out = redactPII([1, 2, 'three']);
    expect(out).toEqual([1, 2, 'three']);
  });

  it('redacts Buffer-like payloads to [BUFFER]', () => {
    const buf = new Uint8Array([1, 2, 3]);
    expect(redactPII(buf)).toBe('[BUFFER]');
  });

  it('handles cycles without crashing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    const out = redactPII(a) as Record<string, unknown>;
    expect(out.self).toBe('[CIRCULAR]');
  });

  it('respects custom field list', () => {
    const out = redactPII(
      { custom: 'X', email: 'y@z.com' },
      { fields: ['custom'] },
    ) as Record<string, unknown>;
    expect(out.custom).toBe('[REDACTED]:custom');
    expect(out.email).toBe('y@z.com');
  });

  it('respects custom format', () => {
    const out = redactPII(
      { email: 'a@b.com' },
      { format: (n) => `<scrub-${n}>` },
    );
    expect(out.email).toBe('<scrub-email>');
  });

  it('respects maxDepth', () => {
    let nested: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 20; i++) {
      nested = { down: nested };
    }
    const out = redactPII(nested, { maxDepth: 3 });
    // Walk down 3 levels — the next layer should be '[DEPTH_LIMIT]'
    let cur: unknown = out;
    for (let i = 0; i < 4; i++) {
      cur = (cur as { down?: unknown }).down;
    }
    expect(cur).toBe('[DEPTH_LIMIT]');
  });

  it('preserves Date as ISO string', () => {
    const d = new Date('2026-05-24T10:00:00Z');
    const out = redactPII({ when: d });
    expect(out.when).toBe(d.toISOString());
  });

  it('redacts Error to {name, message} (drops stack)', () => {
    const e = new Error('boom');
    const out = redactPII({ err: e });
    expect(out.err).toEqual({ name: 'Error', message: 'boom' });
  });

  it('default field list includes common auth + PII names', () => {
    expect(DEFAULT_PII_FIELDS).toContain('password');
    expect(DEFAULT_PII_FIELDS).toContain('email');
    expect(DEFAULT_PII_FIELDS).toContain('mpesaNumber');
    expect(DEFAULT_PII_FIELDS).toContain('gpsLat');
  });
});

describe('wrapLoggerWithRedaction', () => {
  it('redacts the args of each logger method', () => {
    const captured: Array<[string, unknown[]]> = [];
    const logger = {
      info: (...args: unknown[]) => {
        captured.push(['info', args]);
      },
      warn: (...args: unknown[]) => {
        captured.push(['warn', args]);
      },
      error: (...args: unknown[]) => {
        captured.push(['error', args]);
      },
    };
    const safe = wrapLoggerWithRedaction(logger);
    safe.info?.('user created', { email: 'a@b.com', userId: 'u1' });
    safe.warn?.({ phone: '+15550100' }, 'phone change');
    safe.error?.('oops');

    expect(captured.length).toBe(3);
    const infoArgs = captured[0]?.[1] as unknown[];
    expect((infoArgs[1] as Record<string, unknown>).email).toBe(
      '[REDACTED]:email',
    );
    expect((infoArgs[1] as Record<string, unknown>).userId).toBe('u1');
    const warnArgs = captured[1]?.[1] as unknown[];
    expect((warnArgs[0] as Record<string, unknown>).phone).toBe(
      '[REDACTED]:phone',
    );
    const errorArgs = captured[2]?.[1] as unknown[];
    expect(errorArgs[0]).toBe('oops');
  });
});
