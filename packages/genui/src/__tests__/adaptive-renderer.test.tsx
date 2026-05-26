/**
 * Regression tests for HIGH H10/H11 — AdaptiveRenderer defense-in-depth
 * schema validation + unknown-kind telemetry.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import {
  AdaptiveRenderer,
  type GenUiUnknownKindEventDetail,
} from '../AdaptiveRenderer';

describe('AdaptiveRenderer — H10 schema re-validation at dispatch', () => {
  it('routes a malformed payload (missing required field) to UnknownKindCard with "malformed" tag', () => {
    // markdown-card requires `markdown: string.min(1)`. Omitting it
    // means safeParse fails inside the component AND now inside the
    // dispatcher pre-check.
    const onUnknownKind = vi.fn();
    const { container } = render(
      <AdaptiveRenderer
        // @ts-expect-error -- intentionally malformed: omitting required `markdown` to exercise the schema guard
        uiPart={{ kind: 'markdown-card' }}
        onUnknownKind={onUnknownKind}
      />,
    );
    // The dispatcher fires UnknownKindCard with the malformed flag in
    // the displayed kind label.
    const unknownEl = container.querySelector('[data-genui-unknown-kind]');
    expect(unknownEl).not.toBeNull();
    expect(unknownEl?.getAttribute('data-genui-unknown-kind')).toContain('malformed');
    // Callback fired with schema-validation-failed reason.
    expect(onUnknownKind).toHaveBeenCalledOnce();
    const detail = onUnknownKind.mock.calls[0]![0] as GenUiUnknownKindEventDetail;
    expect(detail.reason).toBe('schema-validation-failed');
    expect(detail.kind).toBe('markdown-card');
  });

  it('passes through a valid payload to the matching primitive', () => {
    const onUnknownKind = vi.fn();
    const { container } = render(
      <AdaptiveRenderer
        uiPart={{ kind: 'markdown-card', markdown: 'Hello world.' }}
        onUnknownKind={onUnknownKind}
      />,
    );
    // The unknown-kind card must NOT have been rendered.
    expect(container.querySelector('[data-genui-unknown-kind]')).toBeNull();
    // No telemetry fired.
    expect(onUnknownKind).not.toHaveBeenCalled();
  });
});

describe('AdaptiveRenderer — H11 unknown-kind telemetry', () => {
  it('fires window CustomEvent + onUnknownKind callback for an unknown kind', () => {
    const onUnknownKind = vi.fn();
    const evtSpy = vi.fn();
    window.addEventListener('genui:unknown-kind', evtSpy);
    try {
      render(
        <AdaptiveRenderer
          // @ts-expect-error -- intentionally unknown kind to exercise telemetry path
          uiPart={{ kind: 'totally-new-primitive-the-client-does-not-know' }}
          onUnknownKind={onUnknownKind}
        />,
      );
    } finally {
      window.removeEventListener('genui:unknown-kind', evtSpy);
    }
    // Callback fired.
    expect(onUnknownKind).toHaveBeenCalledOnce();
    const detail = onUnknownKind.mock.calls[0]![0] as GenUiUnknownKindEventDetail;
    expect(detail.reason).toBe('unknown-kind');
    expect(detail.kind).toBe('totally-new-primitive-the-client-does-not-know');
    // CustomEvent dispatched on window.
    expect(evtSpy).toHaveBeenCalledOnce();
    const evt = evtSpy.mock.calls[0]![0] as CustomEvent<GenUiUnknownKindEventDetail>;
    expect(evt.detail.reason).toBe('unknown-kind');
  });

  it('host callback errors do NOT break the render (defensive)', () => {
    const onUnknownKind = vi.fn(() => {
      throw new Error('host telemetry pipeline crashed');
    });
    // Render must not throw.
    expect(() =>
      render(
        <AdaptiveRenderer
          // @ts-expect-error -- intentionally unknown kind to assert host-callback errors do not break render
          uiPart={{ kind: 'made-up' }}
          onUnknownKind={onUnknownKind}
        />,
      ),
    ).not.toThrow();
    expect(onUnknownKind).toHaveBeenCalledOnce();
  });
});
