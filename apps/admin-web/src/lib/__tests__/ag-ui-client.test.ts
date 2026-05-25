/**
 * AG-UI client — unit tests for the pure helpers + dedupe logic.
 *
 * The React hook itself is tested indirectly via the helper exports
 * (`__test`) because the admin-web app does not currently
 * carry a React-Testing-Library setup. The helpers cover the
 * load-bearing logic: event-key derivation (dedupe-on-replay), SSE
 * frame parsing, and the backoff defaults. End-to-end behaviour is
 * covered by C4's Playwright sweep once the gen-UI primitives land.
 */

import { describe, it, expect } from 'vitest';
import { __test } from '../ag-ui-client';
import type { AgUiEvent } from '@borjie/central-intelligence';

const { eventKey, defaultEndpoint, parseSseBuffer, MAX_BACKOFF_MS, DEFAULT_BACKOFF_MS, DEFAULT_MAX_RETRIES } = __test;

describe('ag-ui-client — defaultEndpoint()', () => {
  it('builds the central-command thread path', () => {
    expect(defaultEndpoint('th_abc')).toBe(
      '/api/platform/intelligence/thread/th_abc/message',
    );
  });

  it('URL-encodes the threadId so weird ids do not break routing', () => {
    expect(defaultEndpoint('th/with slash')).toBe(
      '/api/platform/intelligence/thread/th%2Fwith%20slash/message',
    );
  });
});

describe('ag-ui-client — eventKey() dedupe surface', () => {
  it('builds a stable key for RUN_STARTED', () => {
    const event: AgUiEvent = {
      type: 'RUN_STARTED',
      threadId: 'th',
      runId: 'r1',
      timestamp: 1,
    };
    expect(eventKey(event)).toBe('RUN_STARTED:r1');
  });

  it('builds a stable key for terminal events', () => {
    expect(
      eventKey({ type: 'RUN_FINISHED', runId: 'r1' }),
    ).toBe('RUN_FINISHED:r1');
    expect(
      eventKey({ type: 'RUN_ERROR', runId: 'r1', error: 'x' }),
    ).toBe('RUN_ERROR:r1');
  });

  it('builds keys for TEXT_MESSAGE_* by messageId', () => {
    expect(
      eventKey({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }),
    ).toBe('TEXT_MESSAGE_START:m');
    expect(
      eventKey({ type: 'TEXT_MESSAGE_END', messageId: 'm' }),
    ).toBe('TEXT_MESSAGE_END:m');
  });

  it('builds keys for TOOL_CALL_* by toolCallId', () => {
    expect(
      eventKey({ type: 'TOOL_CALL_START', toolCallId: 'tc', toolName: 'gate' }),
    ).toBe('TOOL_CALL_START:tc');
    expect(
      eventKey({ type: 'TOOL_RESULT', toolCallId: 'tc', result: {} }),
    ).toBe('TOOL_RESULT:tc');
  });

  it('returns null for STATE_* events (no natural dedupe key)', () => {
    expect(
      eventKey({ type: 'STATE_SNAPSHOT', state: {} }),
    ).toBeNull();
    expect(
      eventKey({ type: 'STATE_DELTA', patch: [] }),
    ).toBeNull();
  });
});

describe('ag-ui-client — backoff defaults', () => {
  it('defaults match the spec', () => {
    expect(DEFAULT_BACKOFF_MS).toBe(250);
    expect(MAX_BACKOFF_MS).toBe(8_000);
    expect(DEFAULT_MAX_RETRIES).toBe(6);
  });

  it('the doubling sequence caps at MAX_BACKOFF_MS', () => {
    const attempts = [0, 1, 2, 3, 4, 5];
    const delays = attempts.map((a) =>
      Math.min(DEFAULT_BACKOFF_MS * 2 ** a, MAX_BACKOFF_MS),
    );
    expect(delays).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000]);
  });
});

describe('ag-ui-client — SSE buffer parser (re-exported)', () => {
  it('parses a single AG-UI frame', () => {
    const buf = `event: RUN_STARTED\ndata: {"type":"RUN_STARTED","threadId":"t","runId":"r","timestamp":1}\n\n`;
    const step = parseSseBuffer(buf);
    expect(step.events).toHaveLength(1);
    expect(step.events[0].event).toBe('RUN_STARTED');
    expect(JSON.parse(step.events[0].data).runId).toBe('r');
  });

  it('preserves a partial trailing frame as remainder', () => {
    const buf = `event: RUN_STARTED\ndata: {"type":"RUN_STARTED"}\n\nevent: TEXT_MESSAGE_S`;
    const step = parseSseBuffer(buf);
    expect(step.events).toHaveLength(1);
    expect(step.remainder).toContain('TEXT_MESSAGE_S');
  });

  it('skips comment-only frames (heartbeats)', () => {
    const buf = `: heartbeat\n\n`;
    const step = parseSseBuffer(buf);
    expect(step.events).toHaveLength(0);
  });
});

describe('ag-ui-client — round-trip event flow (simulated)', () => {
  it('a sequence of AG-UI frames decodes to typed events in order', () => {
    const frames = [
      `event: RUN_STARTED\ndata: ${JSON.stringify({
        type: 'RUN_STARTED',
        threadId: 'th',
        runId: 'r1',
        timestamp: 1,
      })}\n\n`,
      `event: TEXT_MESSAGE_START\ndata: ${JSON.stringify({
        type: 'TEXT_MESSAGE_START',
        messageId: 'm1',
        role: 'assistant',
      })}\n\n`,
      `event: TEXT_MESSAGE_CONTENT\ndata: ${JSON.stringify({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'm1',
        delta: 'hello',
      })}\n\n`,
      `event: TEXT_MESSAGE_END\ndata: ${JSON.stringify({
        type: 'TEXT_MESSAGE_END',
        messageId: 'm1',
      })}\n\n`,
      `event: RUN_FINISHED\ndata: ${JSON.stringify({
        type: 'RUN_FINISHED',
        runId: 'r1',
      })}\n\n`,
    ];

    const seen: string[] = [];
    const seenKeys = new Set<string>();

    for (const frame of frames) {
      const step = parseSseBuffer(frame);
      for (const ev of step.events) {
        const parsed = JSON.parse(ev.data) as AgUiEvent;
        const key = eventKey(parsed);
        if (key && seenKeys.has(key)) continue;
        if (key) seenKeys.add(key);
        seen.push(parsed.type);
      }
    }

    expect(seen).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
  });

  it('replayed frames with matching keys are de-duplicated', () => {
    const frame = `event: RUN_FINISHED\ndata: ${JSON.stringify({
      type: 'RUN_FINISHED',
      runId: 'r1',
    })}\n\n`;
    const seen = new Set<string>();
    let delivered = 0;
    for (let i = 0; i < 3; i += 1) {
      const step = parseSseBuffer(frame);
      for (const ev of step.events) {
        const parsed = JSON.parse(ev.data) as AgUiEvent;
        const key = eventKey(parsed);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        delivered += 1;
      }
    }
    expect(delivered).toBe(1);
  });
});
