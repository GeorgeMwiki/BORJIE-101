/**
 * Inline micro-action bridge tests.
 *
 * Three pure units make the home-chat inline blocks EXECUTE instead of
 * being downgraded to a `__inline_action:` text string:
 *
 *   1. mapInlineActionToDispatch — narrows each card's `{ action, payload }`
 *      into the canonical `{ channel, verb, params }` dispatch target (or
 *      null when there is no executable verb → text fallback).
 *   2. buildMicroActionSummary — resolves the localized confirmation line
 *      from the gateway result (EN + SW pure, zero hardcoded copy).
 *   3. dispatchMicroAction / confirmAction — POST + zod-parse the
 *      action-bridge response, degrading gracefully on any failure.
 *
 * Mirrors the teach-sse-normalisers pattern: test the bridge, not the
 * React render machinery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeT } from '@/i18n/resolve';
import { dictionaries } from '@/i18n/dictionaries';
import { mapInlineActionToDispatch } from '../inline-action-map';
import {
  buildMicroActionSummary,
  buildFulfillmentTurn,
} from '../micro-action-summary';

const tEn = makeT(dictionaries.en);
const tSw = makeT(dictionaries.sw);

// ── mapInlineActionToDispatch ───────────────────────────────────────

describe('mapInlineActionToDispatch', () => {
  it('routes a micro_action_card verb + params verbatim', () => {
    const target = mapInlineActionToDispatch({
      action: 'set_reminder',
      payload: { title: 'Renew Geita licence', dueInDays: 60 },
    });
    expect(target).toEqual({
      channel: 'micro-action',
      verb: 'set_reminder',
      params: { title: 'Renew Geita licence', dueInDays: 60 },
    });
  });

  it('routes a confirmation_card primary via actionId + forwarded', () => {
    const target = mapInlineActionToDispatch({
      action: 'primary',
      payload: {
        actionId: 'snooze_reminder',
        kind: 'primary',
        forwarded: { reminderId: 'rem_1', days: 3 },
      },
    });
    expect(target).toEqual({
      channel: 'confirm',
      verb: 'snooze_reminder',
      params: { reminderId: 'rem_1', days: 3 },
    });
  });

  it('flattens data_capture captured fields up beside the verb', () => {
    const target = mapInlineActionToDispatch({
      action: 'set_reminder',
      payload: {
        purpose: 'Schedule the EIA review',
        captured: { title: 'EIA review', dueInDays: '14' },
      },
    });
    expect(target).toEqual({
      channel: 'micro-action',
      verb: 'set_reminder',
      params: {
        purpose: 'Schedule the EIA review',
        title: 'EIA review',
        dueInDays: '14',
      },
    });
  });

  it.each([
    ['file upload', { action: 'upload', payload: { whatFor: 'x', files: [] } }],
    ['spawn_tab', { action: 'spawn_tab', payload: { tabType: 'docs' } }],
    ['level_select', { action: 'level_select', payload: { label: 'Beginner' } }],
    ['confirmation cancel', { action: 'secondary', payload: { actionId: 'x' } }],
    ['empty action', { action: '', payload: {} }],
  ])('returns null (text fallback) for %s', (_label, event) => {
    expect(mapInlineActionToDispatch(event)).toBeNull();
  });

  it('returns null when a confirmation primary carries no actionId', () => {
    expect(
      mapInlineActionToDispatch({
        action: 'primary',
        payload: { kind: 'primary', forwarded: {} },
      }),
    ).toBeNull();
  });
});

// ── buildMicroActionSummary ─────────────────────────────────────────

describe('buildMicroActionSummary', () => {
  it('builds a dated set_reminder line in English', () => {
    const summary = buildMicroActionSummary({
      t: tEn,
      verb: 'set_reminder',
      result: { title: 'Renew Geita licence', dueInDays: 60 },
      params: {},
    });
    expect(summary).toBe('Reminder set — Renew Geita licence in 60 days');
  });

  it('falls back to params when the server echoes nothing', () => {
    const summary = buildMicroActionSummary({
      t: tEn,
      verb: 'set_reminder',
      result: undefined,
      params: { title: 'File royalty', dueInDays: 7 },
    });
    expect(summary).toBe('Reminder set — File royalty in 7 days');
  });

  it('builds a snooze_reminder line', () => {
    const summary = buildMicroActionSummary({
      t: tEn,
      verb: 'snooze_reminder',
      result: { days: 3 },
      params: {},
    });
    expect(summary).toBe('Reminder snoozed 3 days');
  });

  it('uses the generic completion line for an unknown verb', () => {
    const summary = buildMicroActionSummary({
      t: tEn,
      verb: 'mark_renewed',
      result: {},
      params: {},
    });
    expect(summary).toBe('Action completed.');
  });

  it('renders the Swahili summary with zero English leakage', () => {
    const summary = buildMicroActionSummary({
      t: tSw,
      verb: 'set_reminder',
      result: { title: 'Geita', dueInDays: 60 },
      params: {},
    });
    expect(summary).toContain('Kikumbusho kimewekwa');
    expect(summary).not.toMatch(/Reminder|days/);
  });
});

// ── buildFulfillmentTurn (generative defer-to-brain) ────────────────

describe('buildFulfillmentTurn', () => {
  it('prefers a human label from the payload + appends scalar params', () => {
    const turn = buildFulfillmentTurn({
      t: tEn,
      verb: 'draft_preview.send',
      params: { title: 'NEMC site-visit request', draftId: 'd-1', revisionNo: 3 },
    });
    // Uses the title as the action phrase; draftId/revisionNo become details.
    expect(turn).toContain('NEMC site-visit request');
    expect(turn).toContain('draftId: d-1');
    expect(turn).toContain('revisionNo: 3');
    expect(turn.startsWith('Please go ahead with:')).toBe(true);
  });

  it('humanises a bare verb token when no label is present', () => {
    const turn = buildFulfillmentTurn({
      t: tEn,
      verb: 'workflow_step_action',
      params: {},
    });
    expect(turn).toBe('Please go ahead with: workflow step action.');
  });

  it('drops nested objects from the detail list (legible instruction)', () => {
    const turn = buildFulfillmentTurn({
      t: tEn,
      verb: 'compare_choose',
      params: { optionId: 'opt-2', forwarded: { nested: true } },
    });
    expect(turn).toContain('optionId: opt-2');
    expect(turn).not.toContain('forwarded');
    expect(turn).not.toContain('nested');
  });

  it('renders the Swahili fulfillment turn with zero English leakage', () => {
    const turn = buildFulfillmentTurn({
      t: tSw,
      verb: 'start_quest',
      params: { title: 'NEMC' },
    });
    expect(turn).toContain('Tafadhali endelea na');
    expect(turn).not.toMatch(/Please|Details/);
  });
});

// ── dispatchMicroAction / confirmAction ─────────────────────────────

vi.mock('@/lib/api-client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { apiRequest } from '@/lib/api-client';
import {
  dispatchMicroAction,
  confirmAction,
} from '@/lib/queries/chat-actions';

const mockApiRequest = vi.mocked(apiRequest);

describe('dispatchMicroAction / confirmAction', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('POSTs to the micro-action endpoint and parses an executed result', async () => {
    mockApiRequest.mockResolvedValueOnce({
      executed: true,
      authorized: true,
      result: { title: 'Geita', dueInDays: 60 },
    });
    const result = await dispatchMicroAction({
      verb: 'set_reminder',
      params: { title: 'Geita', dueInDays: 60 },
    });
    expect(result.executed).toBe(true);
    expect(result.authorized).toBe(true);
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/v1/owner/chat/micro-action',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('POSTs to the confirm-action endpoint', async () => {
    mockApiRequest.mockResolvedValueOnce({ executed: true, authorized: true });
    await confirmAction({ verb: 'snooze_reminder', params: { days: 3 } });
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/v1/owner/chat/confirm-action',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('defaults authorized + deferToBrain to false when the wire omits them', async () => {
    mockApiRequest.mockResolvedValueOnce({ executed: false, reason: 'unknown verb' });
    const result = await dispatchMicroAction({ verb: 'mystery', params: {} });
    expect(result).toEqual({
      executed: false,
      authorized: false,
      deferToBrain: false,
      reason: 'unknown verb',
    });
  });

  it('degrades to a graceful unauthorized result on a network/parse failure', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('network unreachable'));
    const result = await dispatchMicroAction({ verb: 'set_reminder', params: {} });
    expect(result).toEqual({
      executed: false,
      authorized: false,
      reason: 'network unreachable',
    });
  });

  it('degrades gracefully when the response is malformed', async () => {
    mockApiRequest.mockResolvedValueOnce({ totally: 'wrong shape' });
    const result = await dispatchMicroAction({ verb: 'set_reminder', params: {} });
    expect(result.executed).toBe(false);
    expect(result.authorized).toBe(false);
  });
});
