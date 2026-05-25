/**
 * Unit tests for createEardhiAdapter — verifies the e-Ardhi land-services
 * adapter composes a BaseConnector with sane defaults, validates input
 * via Zod, and surfaces upstream outcomes faithfully.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEardhiAdapter,
  VerifyTitleInputSchema,
  TitleNumberSchema,
  EncumbranceSchema,
} from '../adapters/eardhi-adapter.js';
import { createInMemoryEventSink } from '../in-memory-event-sink.js';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_INPUT = { titleNumber: 'DSM/0014/000123' };
const HAPPY_BODY = {
  valid: true,
  owner_name: 'Borjie Investments Ltd',
  registered_at: '2022-03-15',
  encumbrances: [
    {
      kind: 'mortgage' as const,
      noteRef: 'MTG-2023-0042',
      registeredAt: '2023-01-10',
      notes: 'NMB Bank — 30M TZS',
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

describe('createEardhiAdapter — factory', () => {
  it('exposes connector with id "eardhi"', () => {
    const adapter = createEardhiAdapter({ fetch: vi.fn() });
    expect(adapter.connector.id).toBe('eardhi');
  });

  it('uses stub baseUrl when none provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    await adapter.verifyTitle(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://stub.eardhi.local')).toBe(true);
    expect(url).toContain('/v1/title/verify');
  });

  it('respects override baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({
      fetch: fetchMock,
      baseUrl: 'https://ardhi.test',
    });
    await adapter.verifyTitle(VALID_INPUT);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe('ardhi.test');
  });
});

describe('createEardhiAdapter — happy path', () => {
  it('returns ok with parsed body on 200 success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle(VALID_INPUT);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.valid).toBe(true);
      expect(out.data.owner_name).toBe('Borjie Investments Ltd');
      expect(out.data.encumbrances).toHaveLength(1);
      expect(out.data.encumbrances[0]!.kind).toBe('mortgage');
    }
  });

  it('returns ok with empty encumbrances list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...HAPPY_BODY, encumbrances: [] }));
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle(VALID_INPUT);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.data.encumbrances).toHaveLength(0);
  });

  it('emits events to the supplied sink', async () => {
    const events = createInMemoryEventSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({ fetch: fetchMock, events });
    await adapter.verifyTitle(VALID_INPUT);
    const kinds = events.events().map((e) => e.kind);
    expect(kinds).toContain('request');
    expect(kinds).toContain('response');
  });

  it('records an audit entry on success', async () => {
    const audit = createInMemoryAuditSink();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({ fetch: fetchMock, audit });
    await adapter.verifyTitle(VALID_INPUT);
    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({
      outcome: 'ok',
      connectorId: 'eardhi',
    });
  });

  it('passes idempotency key through to fetch headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HAPPY_BODY));
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    await adapter.verifyTitle(VALID_INPUT, 'idem-eardhi-1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBe('idem-eardhi-1');
  });
});

describe('createEardhiAdapter — input validation', () => {
  it('rejects bad title number (lowercase region code)', async () => {
    const fetchMock = vi.fn();
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle({ titleNumber: 'dsm/0014/000123' });
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects bad title number (wrong segment count)', () => {
    expect(TitleNumberSchema.safeParse('DSM/0014').success).toBe(false);
  });

  it('rejects empty title number', () => {
    expect(TitleNumberSchema.safeParse('').success).toBe(false);
  });
});

describe('createEardhiAdapter — output validation', () => {
  it('returns validation-failed when encumbrance kind is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...HAPPY_BODY,
        encumbrances: [
          {
            kind: 'mystery',
            noteRef: 'X',
            registeredAt: '2023-01-10',
          },
        ],
      }),
    );
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle(VALID_INPUT);
    expect(out.kind).toBe('validation-failed');
  });

  it('returns validation-failed when registered_at is wrong format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { ...HAPPY_BODY, registered_at: '15/03/2022' }),
      );
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle(VALID_INPUT);
    expect(out.kind).toBe('validation-failed');
  });
});

describe('createEardhiAdapter — upstream errors', () => {
  it('returns upstream-error on 404 without retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { message: 'title not found' }));
    const adapter = createEardhiAdapter({ fetch: fetchMock });
    const out = await adapter.verifyTitle(VALID_INPUT);
    expect(out.kind).toBe('upstream-error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('VerifyTitleInputSchema', () => {
  it('accepts well-formed input', () => {
    expect(VerifyTitleInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });
});

describe('EncumbranceSchema', () => {
  it('accepts a court-order encumbrance', () => {
    expect(
      EncumbranceSchema.safeParse({
        kind: 'court-order',
        noteRef: 'CIV-2024-99',
        registeredAt: '2024-04-12',
      }).success,
    ).toBe(true);
  });
});
