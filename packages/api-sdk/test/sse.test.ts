import { describe, expect, it } from 'vitest';
import { consumeSse } from '../src/index.js';

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('consumeSse', () => {
  it('parses a sequence of named events', async () => {
    const body = [
      'event: turn.accepted',
      'data: {"hello":"world"}',
      '',
      'event: message_chunk',
      'data: {"text":"hi"}',
      '',
      'event: done',
      'data: {}',
      '',
    ].join('\n');
    const fetchFn = (async () => sseResponse(body)) as unknown as typeof fetch;
    const frames: Array<{ event: string; data: string }> = [];
    for await (const f of consumeSse({ url: 'http://t', fetchFn })) {
      frames.push({ event: f.event, data: f.data });
    }
    expect(frames).toEqual([
      { event: 'turn.accepted', data: '{"hello":"world"}' },
      { event: 'message_chunk', data: '{"text":"hi"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('parses multi-line data fields by joining with newline', async () => {
    const body = ['event: chunk', 'data: line-1', 'data: line-2', '', ''].join('\n');
    const fetchFn = (async () => sseResponse(body)) as unknown as typeof fetch;
    for await (const f of consumeSse({ url: 'http://t', fetchFn })) {
      expect(f.event).toBe('chunk');
      expect(f.data).toBe('line-1\nline-2');
    }
  });

  it('throws on non-OK responses', async () => {
    const fetchFn = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of consumeSse({ url: 'http://t', fetchFn })) {
        /* drain */
      }
    }).rejects.toThrow(/HTTP 500/);
  });

  it('ignores SSE comments (lines starting with `:`)', async () => {
    const body = [':keepalive', 'event: ping', 'data: {}', '', ''].join('\n');
    const fetchFn = (async () => sseResponse(body)) as unknown as typeof fetch;
    const frames: string[] = [];
    for await (const f of consumeSse({ url: 'http://t', fetchFn })) {
      frames.push(f.event);
    }
    expect(frames).toEqual(['ping']);
  });
});
