'use client';

/**
 * InlineWizardBlock — multi-step form rendered inline.
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineWizardSchema`. Steps render one at a time with a top progress
 * bar (LitFin step dots). State persists in localStorage keyed by
 * `borjie:wizard:<purpose>:<sessionId>` so a scroll doesn't lose work.
 *
 * On final-submit fires `onAction` with `{action: submitAction,
 * payload: {purpose, captured}}`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WizardField {
  readonly key?: string;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?:
    | 'text'
    | 'number'
    | 'date'
    | 'select'
    | 'pml-picker'
    | 'site-picker'
    | 'amount-tzs';
  readonly options?: ReadonlyArray<string>;
  readonly required?: boolean;
  readonly placeholder?: string;
}

interface WizardStep {
  readonly id?: string;
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly intro?: { readonly en?: string; readonly sw?: string };
  readonly fields?: ReadonlyArray<WizardField>;
}

export interface InlineWizardBlock {
  readonly type: 'inline_wizard';
  readonly purpose?: string;
  readonly steps?: ReadonlyArray<WizardStep>;
  readonly submitAction?: string;
  readonly [extra: string]: unknown;
}

export interface InlineWizardBlockProps {
  readonly block: InlineWizardBlock;
  readonly locale: 'sw' | 'en';
  readonly sessionId?: string;
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: {
      readonly purpose: string;
      readonly captured: Record<string, string>;
    };
  }) => void;
}

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

function fieldType(kind: WizardField['kind']): string {
  if (kind === 'number' || kind === 'amount-tzs') return 'number';
  if (kind === 'date') return 'date';
  return 'text';
}

export function InlineWizardBlock({
  block,
  locale,
  sessionId = 'default',
  onAction,
}: InlineWizardBlockProps): ReactElement {
  const purpose = typeof block.purpose === 'string' ? block.purpose : 'wizard';
  const submitAction =
    typeof block.submitAction === 'string' ? block.submitAction : '';
  const steps = Array.isArray(block.steps)
    ? block.steps.filter((s): s is WizardStep => Boolean(s)).slice(0, 8)
    : [];

  const storageKey = `borjie:wizard:${purpose}:${sessionId}`;
  const [stepIdx, setStepIdx] = useState(0);
  const [captured, setCaptured] = useState<Record<string, string>>({});

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { captured?: Record<string, string> };
        if (parsed && typeof parsed.captured === 'object') {
          setCaptured(parsed.captured);
        }
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  // Persist on change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ captured }));
    } catch {
      // ignore
    }
  }, [captured, storageKey]);

  const safeIdx = Math.max(0, Math.min(stepIdx, steps.length - 1));
  const step = steps[safeIdx];
  const isLast = safeIdx === steps.length - 1;

  const fields = useMemo(
    () =>
      Array.isArray(step?.fields)
        ? step!.fields.filter((f): f is WizardField => Boolean(f)).slice(0, 8)
        : [],
    [step],
  );

  const handleSubmit = useCallback(() => {
    if (submitAction.length === 0) return;
    onAction?.({
      action: submitAction,
      payload: { purpose, captured },
    });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [submitAction, purpose, captured, storageKey, onAction]);

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface/60 p-3 text-tiny text-foreground/60">
        {locale === 'sw' ? 'Wizard tupu' : 'Empty wizard'}
      </div>
    );
  }

  return (
    <div
      data-testid="inline-block-inline-wizard"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <div className="flex items-center gap-1.5">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`inline-block h-1.5 w-6 rounded-full transition-colors ${i <= safeIdx ? 'bg-warning' : 'bg-neutral-700'}`}
            aria-hidden="true"
          />
        ))}
        <span className="ml-2 text-tiny text-foreground/60">
          {safeIdx + 1}/{steps.length}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        {localised(step?.title, locale, `Step ${safeIdx + 1}`)}
      </h3>
      {step?.intro ? (
        <p className="mt-1 text-tiny text-foreground/70">
          {localised(step.intro, locale, '')}
        </p>
      ) : null}
      <div className="mt-3 space-y-2.5">
        {fields.map((f, i) => {
          const key = typeof f.key === 'string' ? f.key : `f_${i}`;
          const kind = f.kind ?? 'text';
          const lab = localised(f.label, locale, key);
          const placeholder =
            typeof f.placeholder === 'string' ? f.placeholder : '';
          if (kind === 'select' && Array.isArray(f.options)) {
            return (
              <label key={key} className="block text-sm">
                <span className="block text-tiny font-medium text-foreground/80">
                  {lab}
                </span>
                <select
                  value={captured[key] ?? ''}
                  onChange={(e) =>
                    setCaptured({ ...captured, [key]: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">{placeholder || (locale === 'sw' ? 'Chagua' : 'Select')}</option>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <label key={key} className="block text-sm">
              <span className="block text-tiny font-medium text-foreground/80">
                {lab}
                {kind === 'amount-tzs' ? ' (TZS)' : null}
              </span>
              <input
                type={fieldType(kind)}
                placeholder={placeholder}
                value={captured[key] ?? ''}
                onChange={(e) =>
                  setCaptured({ ...captured, [key]: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStepIdx(Math.max(0, safeIdx - 1))}
          disabled={safeIdx === 0}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-tiny font-medium text-foreground/80 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          {locale === 'sw' ? 'Rudi' : 'Back'}
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitAction.length === 0}
            className="rounded-md bg-warning px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locale === 'sw' ? 'Tuma' : 'Submit'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIdx(Math.min(steps.length - 1, safeIdx + 1))}
            className="inline-flex items-center gap-1 rounded-md bg-warning/80 px-2.5 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-warning"
          >
            {locale === 'sw' ? 'Endelea' : 'Next'}
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
