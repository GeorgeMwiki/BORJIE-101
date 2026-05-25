/**
 * Tests for the Jarvis SSE stream module.
 *
 * Coverage:
 *   1. parseSseBlock — parses event/data, ignores keep-alive, rejects malformed
 *   2. translateEvent — turn_start sets persona, delta accumulates, done synthesises decision
 *   3. createJarvisStream — full SSE sequence parsed end-to-end
 *   4. createJarvisStream — multiple deltas accumulate into the synthesised decision
 *   5. createJarvisStream — abort cancels the in-flight request
 *   6. createJarvisStream — malformed SSE block is silently dropped
 *   7. createJarvisStream — error event propagates as a JarvisStreamEvent
 *   8. createJarvisStream — done event terminates iteration
 */

import { describe, it, expect, vi } from 'vitest';
import { createBossnyumbaClient } from '../client.js';
import {
  createJarvisStream,
  parseSseBlock,
  translateEvent,
  type JarvisStreamEvent,
} from '../jarvis-stream.js';

// ---------------------------------------------------------------------------
// Helpers — encode an array of events into a chunked SSE Response.
// ---------------------------------------------------------------------------

function makeSseResponse(
  events: ReadonlyArray<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  const chunks = events.map(
    (e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`,
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeRawResponse(rawText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(rawText));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(
  events: AsyncIterable<JarvisStreamEvent>,
): Promise<JarvisStreamEvent[]> {
  const out: JarvisStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function makeClient(fetchFn: typeof fetch) {
  return createBossnyumbaClient({
    baseUrl: 'http://api.test',
    fetchFn,
  });
}

const REQ = { threadId: 't1', userMessage: 'hi' } as const;

// ---------------------------------------------------------------------------
// Pure parser tests
// ---------------------------------------------------------------------------

describe('parseSseBlock', () => {
  it('parses an event/data block', () => {
    const block = parseSseBlock('event: delta\ndata: {"delta":"hi"}');
    expect(block).toEqual({ event: 'delta', data: '{"delta":"hi"}' });
  });

  it('ignores SSE keep-alive comments', () => {
    expect(parseSseBlock(': keep-alive')).toBeNull();
  });

  it('returns null when there is no event line', () => {
    expect(parseSseBlock('data: {"x":1}')).toBeNull();
  });
});

describe('translateEvent', () => {
  it('turn_start populates the accumulator persona + thoughtId', () => {
    const acc = freshAcc();
    const out = translateEvent(
      {
        event: 'turn_start',
        data: JSON.stringify({
          persona: { id: 'p1', displayName: 'Niamh', firstPersonNoun: 'I' },
          thoughtId: 'tho-1',
        }),
      },
      acc,
    );
    expect(out).toHaveLength(1);
    const ev = out[0]!;
    expect(ev?.kind).toBe('turn_start');
    if (ev?.kind === 'turn_start') {
      expect(ev.persona.displayName).toBe('Niamh');
      expect(ev.thoughtId).toBe('tho-1');
    }
    expect(acc.persona?.displayName).toBe('Niamh');
  });

  it('delta accumulates text into the accumulator', () => {
    const acc = freshAcc();
    translateEvent(
      { event: 'delta', data: JSON.stringify({ delta: 'Hello ' }) },
      acc,
    );
    translateEvent(
      { event: 'delta', data: JSON.stringify({ delta: 'world' }) },
      acc,
    );
    expect(acc.text).toBe('Hello world');
  });

  it('done synthesises a decision from the accumulator', () => {
    const acc = freshAcc();
    acc.text = 'Hello world';
    acc.confidence = {
      groundedness: 0.9,
      stability: 0.8,
      review: 0.7,
      numericalConsistency: 0.95,
      overall: 0.84,
    };
    const out = translateEvent(
      {
        event: 'done',
        data: JSON.stringify({ thoughtId: 'tho-2', kind: 'answer' }),
      },
      acc,
    );
    expect(out).toHaveLength(1);
    const ev = out[0]!;
    expect(ev?.kind).toBe('done');
    if (ev?.kind === 'done') {
      expect(ev.decision.kind).toBe('answer');
      expect(ev.decision.text).toBe('Hello world');
      expect(ev.decision.provenance.thoughtId).toBe('tho-2');
      expect(ev.decision.confidence?.overall).toBeCloseTo(0.84);
    }
  });

  it('drops events with malformed JSON', () => {
    const out = translateEvent({ event: 'delta', data: 'not-json' }, freshAcc());
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — full SSE round-trips via stubbed fetch
// ---------------------------------------------------------------------------

describe('createJarvisStream', () => {
  it('decodes a full SSE turn into a JarvisStreamEvent[] sequence', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseResponse([
        {
          event: 'turn_start',
          data: {
            persona: { id: 'p', displayName: 'Niamh', firstPersonNoun: 'I' },
            thoughtId: 'tho-1',
          },
        },
        { event: 'delta', data: { delta: 'Hi ' } },
        { event: 'delta', data: { delta: 'there' } },
        {
          event: 'confidence',
          data: {
            groundedness: 0.9,
            stability: 0.85,
            review: 0.8,
            numericalConsistency: 0.95,
            overall: 0.87,
          },
        },
        { event: 'done', data: { thoughtId: 'tho-1', kind: 'answer' } },
      ]),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const events = await collect(handle.events());

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(['turn_start', 'delta', 'delta', 'confidence', 'done']);
  });

  it('multiple deltas accumulate into the synthesised final decision text', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseResponse([
        {
          event: 'turn_start',
          data: {
            persona: { id: 'p', displayName: 'Niamh', firstPersonNoun: 'I' },
            thoughtId: 'tho-2',
          },
        },
        { event: 'delta', data: { delta: 'one ' } },
        { event: 'delta', data: { delta: 'two ' } },
        { event: 'delta', data: { delta: 'three' } },
        { event: 'done', data: { thoughtId: 'tho-2', kind: 'answer' } },
      ]),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const events = await collect(handle.events());

    const last = events[events.length - 1]!;
    expect(last.kind).toBe('done');
    if (last.kind === 'done') {
      expect(last.decision.text).toBe('one two three');
    }
  });

  it('abort() cancels the in-flight fetch', async () => {
    const aborted = vi.fn();
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', aborted);
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const iter = handle.events()[Symbol.asyncIterator]();
    const next = iter.next();
    // Give the generator a chance to enter the fetch await + register
    // its abort listener on the signal before we trigger abort().
    await new Promise((r) => setTimeout(r, 0));
    handle.abort();
    await next; // resolves once the iterator returns from the aborted fetch
    expect(aborted).toHaveBeenCalled();
  });

  it('silently drops malformed SSE blocks and keeps reading', async () => {
    const fetchFn = vi.fn(async () =>
      makeRawResponse(
        // First block: malformed JSON.
        'event: delta\ndata: not-json\n\n' +
          // Second block: valid delta.
          'event: delta\ndata: {"delta":"ok"}\n\n' +
          // Third block: done.
          'event: done\ndata: {"thoughtId":"t","kind":"answer"}\n\n',
      ),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const events = await collect(handle.events());

    // Only the valid delta + the done event should make it out.
    expect(events.map((e) => e.kind)).toEqual(['delta', 'done']);
    const delta = events[0];
    if (delta?.kind === 'delta') expect(delta.text).toBe('ok');
  });

  it('propagates a server-emitted error event', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseResponse([
        { event: 'error', data: { message: 'kernel boom' } },
        { event: 'done', data: { thoughtId: '', kind: 'refusal' } },
      ]),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const events = await collect(handle.events());

    const errEv = events.find((e) => e.kind === 'error');
    expect(errEv).toBeDefined();
    if (errEv?.kind === 'error') expect(errEv.message).toBe('kernel boom');
    const lastEv = events[events.length - 1];
    expect(lastEv?.kind).toBe('done');
  });

  it('done event terminates iteration', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseResponse([
        {
          event: 'turn_start',
          data: {
            persona: { id: 'p', displayName: 'X', firstPersonNoun: 'I' },
            thoughtId: 't',
          },
        },
        { event: 'delta', data: { delta: 'a' } },
        { event: 'done', data: { thoughtId: 't', kind: 'answer' } },
      ]),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ);
    const iter = handle.events()[Symbol.asyncIterator]();
    const a = await iter.next();
    const b = await iter.next();
    const c = await iter.next();
    const tail = await iter.next();
    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    expect(c.done).toBe(false);
    expect(tail.done).toBe(true);
  });

  it('emits an error event when fetch fails after the reconnect budget', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const handle = createJarvisStream(client, 'platform', REQ, {
      maxReconnect: 0,
    });
    const events = await collect(handle.events());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    if (events[0]?.kind === 'error') {
      expect(events[0].message).toContain('boom');
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AccShape {
  persona: { id: string; displayName: string; firstPersonNoun: string } | null;
  text: string;
  thinking: string;
  confidence: {
    groundedness: number;
    stability: number;
    review: number;
    numericalConsistency: number;
    overall: number;
  } | null;
  gate: { verdict: 'pass' | 'soften' | 'block'; reason?: string } | null;
  error: string | null;
  thoughtId: string | null;
}

function freshAcc(): AccShape {
  return {
    persona: null,
    text: '',
    thinking: '',
    confidence: null,
    gate: null,
    error: null,
    thoughtId: null,
  };
}
