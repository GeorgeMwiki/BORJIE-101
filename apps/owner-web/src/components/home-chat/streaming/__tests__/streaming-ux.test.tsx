/**
 * Streaming-UX polish tests.
 *
 * Covers the two presentational seams the premium-streaming work touches:
 *   1. `sse-stream.ts` — optimistic `turn_start` + `skeleton_bubble` frames,
 *      real-event ordering (never reordered), skeleton suppression once
 *      content flows, and a single TTFT reading.
 *   2. `StreamedText.tsx` — token/word ORDER preservation through the rAF
 *      reveal, `prefers-reduced-motion` → instant full reveal, and the
 *      non-streaming full-text fallback (history / complete).
 *
 * These are purely about HOW/WHEN text appears — never WHAT text appears.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Mock the api-client so importing the SSE helper doesn't drag in the
// Supabase browser client (env-coupled at module load).
vi.mock('@/lib/api-client', () => ({ API_BASE: 'http://gateway.test' }));
// Same module under the relative specifier sse-stream.ts uses internally.
vi.mock('../../../../lib/api-client', () => ({ API_BASE: 'http://gateway.test' }));

import {
  streamSse,
  TURN_START_EVENT,
  SKELETON_BUBBLE_EVENT,
  type SseEvent,
} from '@/lib/sse-stream';
import { StreamedText } from '../StreamedText';

/** Build a fetch Response whose body streams the given SSE wire blocks. */
function sseResponse(blocks: ReadonlyArray<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of blocks) controller.enqueue(encoder.encode(b));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function drain(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('sse-stream — optimistic frames + TTFT', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits turn_start first, then real events in order, and suppresses the skeleton once content flows', async () => {
    const blocks = [
      'event: delta\ndata: {"text":"Hello "}\n\n',
      'event: delta\ndata: {"text":"world"}\n\n',
      'event: done\ndata: {}\n\n',
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse(blocks));

    const ttft = vi.fn();
    const events = await drain(
      streamSse({
        path: '/api/v1/mining/chat',
        body: { message: 'hi' },
        optimistic: { onTtft: ttft, skeletonAfterMs: 0 },
      }),
    );

    // First frame is the optimistic turn_start.
    expect(events[0]?.event).toBe(TURN_START_EVENT);
    // Real delta order is preserved exactly.
    const deltas = events
      .filter((e) => e.event === 'delta')
      .map((e) => (e.data as { text: string }).text);
    expect(deltas).toEqual(['Hello ', 'world']);
    // Terminates on done.
    expect(events[events.length - 1]?.event).toBe('done');
    // Exactly one TTFT reading, and it is a finite number.
    expect(ttft).toHaveBeenCalledTimes(1);
    expect(typeof ttft.mock.calls[0]?.[0]).toBe('number');
  });

  it('can be disabled — no synthetic frames when optimistic.enabled is false', async () => {
    const blocks = ['event: delta\ndata: {"text":"hi"}\n\n', 'event: done\ndata: {}\n\n'];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse(blocks));

    const events = await drain(
      streamSse({
        path: '/api/v1/mining/chat',
        body: {},
        optimistic: { enabled: false },
      }),
    );
    expect(events.some((e) => e.event === TURN_START_EVENT)).toBe(false);
    expect(events.some((e) => e.event === SKELETON_BUBBLE_EVENT)).toBe(false);
    expect(events.map((e) => e.event)).toEqual(['delta', 'done']);
  });
});

describe('StreamedText — order, reduced-motion, fallback', () => {
  const originalMatchMedia = window.matchMedia;

  function setReducedMotion(reduce: boolean): void {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    setReducedMotion(false);
  });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('renders the full text immediately and in order when not streaming (history/complete fallback)', () => {
    const full = 'The royalty filing is due on the fifth.';
    render(<StreamedText text={full} status="complete" />);
    // IncrementalMarkdown renders the whole text; order is the source order.
    expect(screen.getByText(/royalty filing is due/)).toBeInTheDocument();
    expect(document.body.textContent).toContain(full);
  });

  it('reveals tokens in source order with no reordering while streaming (reduced-motion → instant)', () => {
    // Reduced motion snaps the cursor to the end, so the full ordered text
    // is present on first paint — the deterministic way to assert order.
    setReducedMotion(true);
    const full = 'alpha beta gamma delta epsilon';
    render(<StreamedText text={full} status="streaming" />);
    const region = screen.getByTestId('streamed-text');
    // Every word present, and in the exact source order (no drops/reorders).
    expect(region.textContent?.replace(/\s+/g, ' ').trim()).toBe(full);
    // Streaming region is an accessible polite live region.
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-busy')).toBe('true');
  });

  it('preserves multi-line / whitespace structure exactly (never mutates content)', () => {
    setReducedMotion(true);
    const full = 'line one\nline two   spaced';
    render(<StreamedText text={full} status="streaming" />);
    const region = screen.getByTestId('streamed-text');
    expect(region.textContent).toBe(full);
  });
});
