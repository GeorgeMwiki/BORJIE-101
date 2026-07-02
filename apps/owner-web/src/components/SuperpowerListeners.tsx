'use client';

/**
 * SuperpowerListeners — the owner-surface RECEIVERS for the two
 * born-dark superpower CustomEvents dispatched by
 * `home-chat/SuperpowerChips.tsx`:
 *
 *   - `borjie:form-prefill` (ui_prefill) — the brain promised to
 *     "fill the form for them". Previously the chip dispatched the
 *     event with ZERO listeners, so nothing happened. This receiver
 *     finds the target form (by `data-prefill-form={formId}` or its
 *     DOM id) and writes each `{ name: value }` into the matching
 *     input / textarea / select, dispatching native `input`+`change`
 *     events so React-controlled forms pick the value up. The first
 *     filled field is focused so the owner sees the effect.
 *
 *   - `borjie:highlight` (ui_highlight) — the brain promised to
 *     "show me the tip" by spotlighting a selector with a bilingual
 *     callout. Previously dispatched with ZERO listeners. This
 *     receiver paints a positioned callout over `{selector}` in the
 *     ACTIVE locale only (zero-mix canon — never both languages),
 *     scrolls it into view, and auto-dismisses after `ttl` ms.
 *
 * Mounted once at the owner root layout so it is live on every screen.
 * Pure side-effect island: renders only the transient highlight
 * overlay; the prefill path renders nothing.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { pickByLocale } from '@/lib/locale-shared';
import {
  FORM_PREFILL_EVENT_NAME,
  HIGHLIGHT_EVENT_NAME,
} from './home-chat/superpower-events';

// ─── Shared event payload shapes (mirror SuperpowerChips) ─────────────

interface FormPrefillDetail {
  readonly formId: string;
  readonly values: Record<string, unknown>;
  readonly submitOnAccept: boolean;
}

interface HighlightDetail {
  readonly selector: string;
  readonly message: { en: string; sw: string };
  readonly ttl: number;
  readonly tone: 'info' | 'success' | 'warning' | 'critical';
}

/**
 * Escape a value for safe interpolation into a CSS attribute/id
 * selector. Uses the native `CSS.escape` when present; falls back to a
 * conservative regex for environments (older jsdom) where it is absent.
 */
function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css && typeof css.escape === 'function') return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

// ─── Prefill receiver ─────────────────────────────────────────────────

/**
 * Locate the form the brain wants to fill. Prefer an explicit
 * `data-prefill-form` attribute (the contract markers forms opt into),
 * then fall back to the form's DOM id. Returns null when no form on the
 * current screen matches — an honest no-op, never a thrown error.
 */
export function findPrefillForm(
  root: ParentNode,
  formId: string,
): HTMLFormElement | null {
  const byData = root.querySelector<HTMLFormElement>(
    `form[data-prefill-form="${cssEscape(formId)}"]`,
  );
  if (byData) return byData;
  const el = root.querySelector<HTMLElement>(`#${cssEscape(formId)}`);
  if (el instanceof HTMLFormElement) return el;
  // A container (not a <form>) carrying the id is still fillable.
  return null;
}

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Write one value into a field so a React-controlled input reflects it.
 * We set the value via the native prototype setter and then fire the
 * `input` + `change` events React listens for. Returns true when a
 * field was actually written.
 */
export function fillField(
  scope: ParentNode,
  name: string,
  value: unknown,
): boolean {
  const field = scope.querySelector<Fillable>(
    `[name="${cssEscape(name)}"], #${cssEscape(name)}`,
  );
  if (!field) return false;
  const next = value === null || value === undefined ? '' : String(value);

  if (field instanceof HTMLSelectElement) {
    field.value = next;
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(field, next);
  } else {
    field.value = next;
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Apply a whole prefill payload to the DOM. Exported for direct unit
 * testing (jsdom) without needing to round-trip through the window
 * event. Returns the count of fields actually written + the target so
 * a caller can assert the observable effect and focus the first field.
 */
export function applyFormPrefill(
  root: ParentNode,
  detail: FormPrefillDetail,
): { filled: number; scope: ParentNode | null } {
  const form = findPrefillForm(root, detail.formId);
  const scope: ParentNode =
    form ??
    root.querySelector(`#${cssEscape(detail.formId)}`) ??
    root;
  let filled = 0;
  let firstField: HTMLElement | null = null;
  for (const [name, value] of Object.entries(detail.values)) {
    if (fillField(scope, name, value)) {
      filled += 1;
      if (!firstField) {
        firstField = (scope as ParentNode).querySelector<HTMLElement>(
          `[name="${cssEscape(name)}"], #${cssEscape(name)}`,
        );
      }
    }
  }
  if (firstField && typeof firstField.focus === 'function') {
    firstField.focus();
  }
  return { filled, scope: form ?? scope };
}

// ─── Highlight overlay ────────────────────────────────────────────────

const TONE_CLASS: Readonly<Record<HighlightDetail['tone'], string>> = {
  info: 'border-info/60 bg-info/10 text-info',
  success: 'border-success/60 bg-success/10 text-success',
  warning: 'border-warning/60 bg-warning/10 text-warning',
  critical: 'border-destructive/60 bg-destructive/10 text-destructive',
};

interface ActiveHighlight {
  readonly key: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly tone: HighlightDetail['tone'];
}

export function SuperpowerListeners({
  languagePreference,
}: {
  readonly languagePreference: 'sw' | 'en';
}): ReactElement | null {
  const [highlight, setHighlight] = useState<ActiveHighlight | null>(null);

  // ── ui_prefill receiver ──
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPrefill = (evt: Event) => {
      const detail = (evt as CustomEvent<FormPrefillDetail>).detail;
      if (!detail || typeof detail.formId !== 'string') return;
      applyFormPrefill(document, detail);
    };
    window.addEventListener(FORM_PREFILL_EVENT_NAME, onPrefill);
    return () => window.removeEventListener(FORM_PREFILL_EVENT_NAME, onPrefill);
  }, []);

  // ── ui_highlight receiver ──
  const dismiss = useCallback(() => setHighlight(null), []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timer: number | undefined;
    const onHighlight = (evt: Event) => {
      const detail = (evt as CustomEvent<HighlightDetail>).detail;
      if (!detail || typeof detail.selector !== 'string') return;
      let target: Element | null = null;
      try {
        target = document.querySelector(detail.selector);
      } catch {
        // Malformed selector — never throw into the render loop.
        target = null;
      }
      if (!target) return;
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const rect = target.getBoundingClientRect();
      // ACTIVE locale only — never render both languages (zero-mix canon).
      const label = pickByLocale(languagePreference, detail.message);
      // VIEWPORT coordinates only. The overlay container is `fixed inset-0`
      // (viewport-anchored), so its absolutely-positioned children are laid
      // out relative to the viewport — NOT the scrolled document. Adding
      // window.scrollX/scrollY here double-counts the scroll offset and pushes
      // the callout off the target once the page is scrolled. `rect.top` /
      // `rect.left` from getBoundingClientRect are already viewport-relative.
      setHighlight({
        key: Date.now(),
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        label,
        tone: detail.tone,
      });
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setHighlight(null),
        Math.max(1500, detail.ttl),
      );
    };
    window.addEventListener(HIGHLIGHT_EVENT_NAME, onHighlight);
    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT_NAME, onHighlight);
      if (timer) window.clearTimeout(timer);
    };
  }, [languagePreference]);

  if (!highlight) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      data-testid="superpower-highlight-overlay"
      aria-live="polite"
    >
      <div
        className={`absolute rounded-md border-2 shadow-lg transition-opacity ${TONE_CLASS[highlight.tone]}`}
        style={{
          top: highlight.top - 4,
          left: highlight.left - 4,
          width: highlight.width + 8,
          height: highlight.height + 8,
        }}
      />
      <button
        type="button"
        onClick={dismiss}
        className={`pointer-events-auto absolute max-w-xs rounded-md border px-3 py-2 text-xs shadow-lg ${TONE_CLASS[highlight.tone]}`}
        style={{
          top: highlight.top + highlight.height + 8,
          left: highlight.left,
        }}
        data-testid="superpower-highlight-callout"
      >
        {highlight.label}
      </button>
    </div>
  );
}

export default SuperpowerListeners;
