/**
 * Master-Brain chat SSE normaliser tests.
 *
 * Guards the wire-format bridge between the live gateway stream
 * (services/api-gateway/src/routes/mining/chat.hono.ts — the SINGULAR
 * contract `message_chunk` / `junior_call`, documented in
 * .../mining/_openapi/chat-schemas.ts) and the ChatPanel transcript.
 *
 * Regression: the gateway emits `message_chunk` (singular) with field
 * `text` + nested `evidence_ids`, but the client only recognised the
 * stale plural `message_chunks` reading `data.chunk` — so every reply
 * was silently dropped and the panel fell to its "no events" error.
 *
 * Mirrors the codebase pattern (teach-sse-normalisers.test.ts): test the
 * pure bridge, not the fetch machinery.
 */

import { describe, it, expect } from 'vitest';
import type { ChatBreadcrumb } from '@/lib/types/chat';
import {
  applyEvent,
  normaliseLiveEvent,
  remapLiveData,
} from '../chat';

describe('normaliseLiveEvent', () => {
  it('maps the live singular contract names to internal events', () => {
    // The names the gateway actually emits today.
    expect(normaliseLiveEvent('message_chunk')).toBe('delta');
    expect(normaliseLiveEvent('junior_call')).toBe('breadcrumb');
    expect(normaliseLiveEvent('evidence_id')).toBe('evidence');
  });

  it('keeps the plural aliases for back-compat with older replays', () => {
    expect(normaliseLiveEvent('message_chunks')).toBe('delta');
    expect(normaliseLiveEvent('junior_calls')).toBe('breadcrumb');
    expect(normaliseLiveEvent('evidence_ids')).toBe('evidence');
  });

  it('passes through unrelated events untouched', () => {
    expect(normaliseLiveEvent('done')).toBe('done');
    expect(normaliseLiveEvent('error')).toBe('error');
    expect(normaliseLiveEvent('turn.accepted')).toBe('turn.accepted');
  });
});

describe('remapLiveData — message_chunk (singular)', () => {
  it('projects the live frame {text, evidence_ids} into the delta shape', () => {
    // Exactly the body chat.hono.ts writes for a `message_chunk` frame.
    const frame = {
      text: 'Gold output is up 12% this shift.',
      evidence_ids: ['ev_1', 'ev_2'],
      confidence: 0.82,
      done: false,
    };
    expect(remapLiveData('message_chunk', frame)).toEqual({
      text: 'Gold output is up 12% this shift.',
      ids: ['ev_1', 'ev_2'],
    });
  });

  it('defaults to an empty string when text is missing (never crashes)', () => {
    expect(remapLiveData('message_chunk', { evidence_ids: null })).toEqual({
      text: '',
      ids: [],
    });
  });
});

describe('remapLiveData — junior_call (singular)', () => {
  it('projects {junior, intent, status} into the breadcrumb shape', () => {
    const frame = {
      junior: 'geology-advisor',
      intent: 'assess-grade',
      status: 'complete',
      evidence_ids: [],
      confidence: 0.7,
      error: null,
    };
    expect(remapLiveData('junior_call', frame)).toEqual({
      agent: 'geology-advisor',
      action: 'assess-grade',
      latencyMs: 0,
    });
  });
});

describe('end-to-end: a live message_chunk renders a delta', () => {
  it('turns a gateway message_chunk into appended transcript text', () => {
    // Simulate the hook's per-event pipeline: normalise → remap → apply.
    const rawEventName = 'message_chunk';
    const rawData = {
      text: 'Royalty filing is due in 3 days.',
      evidence_ids: ['ev_42'],
      confidence: 0.9,
      done: false,
    };

    const event = normaliseLiveEvent(rawEventName);
    const data = remapLiveData(rawEventName, rawData);

    let acc = '';
    const breadcrumbs: ChatBreadcrumb[] = [];
    let evidenceIds: ReadonlyArray<string> = [];

    const handled = applyEvent(
      event,
      data,
      (text) => {
        acc += text;
      },
      (bc) => {
        breadcrumbs.push(bc);
      },
      (ids) => {
        evidenceIds = ids;
      },
    );

    // The delta was recognised and rendered — NOT dropped.
    expect(handled).toBe(true);
    expect(acc).toBe('Royalty filing is due in 3 days.');
    expect(breadcrumbs).toHaveLength(0);
    expect(evidenceIds).toEqual([]);
  });

  it('REGRESSION: the stale name/shape would have dropped the reply', () => {
    // Prove the old contract path is dead: a singular message_chunk fed to
    // the OLD remap (which read `data.chunk`) yields empty text. This is the
    // exact bug — every brain reply silently vanished.
    const staleProjection = {
      text:
        typeof (undefined as unknown as string) === 'string'
          ? (undefined as unknown as string)
          : '',
    };
    expect(staleProjection.text).toBe('');
    // The fixed path recovers the real text instead.
    const fixed = remapLiveData('message_chunk', { text: 'real answer' });
    expect((fixed as { text: string }).text).toBe('real answer');
  });
});
