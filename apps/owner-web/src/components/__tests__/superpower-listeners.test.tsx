/**
 * SuperpowerListeners — receiver tests for the two BORN-DARK superpower
 * CustomEvents (`borjie:form-prefill` + `borjie:highlight`).
 *
 * These prove the fix for the "ZERO listeners" finding: before this
 * component existed, `publishFormPrefill` / `publishHighlight` dispatched
 * events nothing consumed. Each test dispatches the real event name and
 * asserts an OBSERVABLE effect (form fields filled / callout painted).
 *
 * RED baseline: without the mounted listener (or with the pre-fix code
 * that never called addEventListener), the field stays empty and no
 * callout renders — both assertions fail.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SuperpowerListeners, applyFormPrefill } from '../SuperpowerListeners';

// Dispatch the real superpower events by their stable public names
// WITHOUT importing SuperpowerChips (that module drags the pino-backed
// sentry sink into jsdom). These mirror FORM_PREFILL_EVENT_NAME /
// HIGHLIGHT_EVENT_NAME exported from SuperpowerChips.
function publishFormPrefill(detail: {
  formId: string;
  values: Record<string, unknown>;
  submitOnAccept: boolean;
}): void {
  window.dispatchEvent(new CustomEvent('borjie:form-prefill', { detail }));
}
function publishHighlight(detail: {
  selector: string;
  message: { en: string; sw: string };
  ttl: number;
  tone: 'info' | 'success' | 'warning' | 'critical';
}): void {
  window.dispatchEvent(new CustomEvent('borjie:highlight', { detail }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('applyFormPrefill (pure DOM writer)', () => {
  it('writes each value into the matching field and reports the count', () => {
    document.body.innerHTML = `
      <form data-prefill-form="royalty">
        <input name="tonnage" />
        <input id="grade" />
        <select name="mineral"><option value="gold">gold</option><option value="copper">copper</option></select>
      </form>
    `;
    const result = applyFormPrefill(document, {
      formId: 'royalty',
      values: { tonnage: 12.5, grade: 'A', mineral: 'copper' },
      submitOnAccept: false,
    });
    expect(result.filled).toBe(3);
    expect(
      (document.querySelector('[name="tonnage"]') as HTMLInputElement).value,
    ).toBe('12.5');
    expect((document.querySelector('#grade') as HTMLInputElement).value).toBe(
      'A',
    );
    expect(
      (document.querySelector('[name="mineral"]') as HTMLSelectElement).value,
    ).toBe('copper');
  });

  it('is an honest no-op when no matching form/field exists', () => {
    document.body.innerHTML = `<form data-prefill-form="other"><input name="x" /></form>`;
    const result = applyFormPrefill(document, {
      formId: 'missing',
      values: { y: 'z' },
      submitOnAccept: false,
    });
    expect(result.filled).toBe(0);
  });
});

describe('SuperpowerListeners — form-prefill event receiver', () => {
  it('fills the target form when borjie:form-prefill is dispatched', () => {
    render(<SuperpowerListeners languagePreference="en" />);
    // The form lives on the page (outside the listener island).
    const host = document.createElement('div');
    host.innerHTML = `<form data-prefill-form="reminder"><input name="title" /></form>`;
    document.body.appendChild(host);

    act(() => {
      publishFormPrefill({
        formId: 'reminder',
        values: { title: 'Renew licence' },
        submitOnAccept: false,
      });
    });

    expect(
      (document.querySelector('[name="title"]') as HTMLInputElement).value,
    ).toBe('Renew licence');
  });
});

describe('SuperpowerListeners — highlight event receiver', () => {
  it('paints a locale-resolved callout over the selector target', () => {
    render(<SuperpowerListeners languagePreference="en" />);
    const target = document.createElement('div');
    target.id = 'tip-target';
    document.body.appendChild(target);

    act(() => {
      publishHighlight({
        selector: '#tip-target',
        message: { en: 'Tap here to file', sw: 'Gusa hapa kuwasilisha' },
        ttl: 8000,
        tone: 'info',
      });
    });

    const callout = screen.getByTestId('superpower-highlight-callout');
    // ACTIVE locale only — English, never the Swahili variant (zero-mix).
    expect(callout.textContent).toBe('Tap here to file');
    expect(callout.textContent).not.toContain('Gusa');
  });

  it('renders nothing when the selector matches no element', () => {
    render(<SuperpowerListeners languagePreference="en" />);
    act(() => {
      publishHighlight({
        selector: '#does-not-exist',
        message: { en: 'x', sw: 'y' },
        ttl: 8000,
        tone: 'info',
      });
    });
    expect(screen.queryByTestId('superpower-highlight-overlay')).toBeNull();
  });
});
