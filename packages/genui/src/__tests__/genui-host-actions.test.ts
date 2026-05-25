/**
 * Regression tests for HIGH H12 — host action dispatcher allowlist.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createGenUiActionDispatcher,
  GENUI_ACTION_EVENTS,
} from '../genui-host-actions';

function mkEvent(detail: unknown): Event {
  return new CustomEvent('genui:tree-action', { detail });
}

describe('createGenUiActionDispatcher (H12)', () => {
  it('allows a tool action when the tool is in the allowlist', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(['tenant.send_reminder']),
      onAllow,
      onReject,
    });
    dispatch(
      mkEvent({ kind: 'tool', payload: { tool: 'tenant.send_reminder' } }),
    );
    expect(onAllow).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('rejects a tool action when the tool is NOT in the allowlist', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(['tenant.send_reminder']),
      onAllow,
      onReject,
    });
    // An LLM-emitted action firing a different tool — the host MUST refuse.
    dispatch(
      mkEvent({
        kind: 'tool',
        payload: { tool: 'admin.revoke_all_grants' },
      }),
    );
    expect(onAllow).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject.mock.calls[0]![0]).toMatch(/admin.revoke_all_grants/);
  });

  it('rejects an unknown action.kind', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(),
      onAllow,
      onReject,
    });
    dispatch(mkEvent({ kind: 'eval-arbitrary-js', payload: {} }));
    expect(onAllow).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject.mock.calls[0]![0]).toMatch(/kind/);
  });

  it('rejects malformed detail (missing payload object)', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(),
      onAllow,
      onReject,
    });
    dispatch(mkEvent('not-an-object'));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject.mock.calls[0]![0]).toMatch(/kind, payload/);
  });

  it('rejects a tool action whose payload omits the tool field', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(['tenant.send_reminder']),
      onAllow,
      onReject,
    });
    dispatch(mkEvent({ kind: 'tool', payload: { not_a_tool: 'x' } }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject.mock.calls[0]![0]).toMatch(/tool/);
  });

  it('allows non-tool kinds (message / navigate) without tool allowlist check', () => {
    const onAllow = vi.fn();
    const onReject = vi.fn();
    const dispatch = createGenUiActionDispatcher({
      allowedTools: new Set(), // empty
      onAllow,
      onReject,
    });
    dispatch(mkEvent({ kind: 'message', payload: { text: 'hi' } }));
    dispatch(mkEvent({ kind: 'navigate', payload: { url: '/page' } }));
    expect(onAllow).toHaveBeenCalledTimes(2);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('exposes the seven action event names so the host can subscribe uniformly', () => {
    expect(GENUI_ACTION_EVENTS).toContain('genui:signature-submit');
    expect(GENUI_ACTION_EVENTS).toContain('genui:tree-action');
    expect(GENUI_ACTION_EVENTS).toContain('genui:unknown-kind');
    expect(GENUI_ACTION_EVENTS.length).toBeGreaterThanOrEqual(7);
  });
});
