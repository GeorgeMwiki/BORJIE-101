'use client';

/**
 * DataCaptureCardBlock — 1-3 inline form fields.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `dataCaptureCardSchema`. Compact form rendered in the assistant
 * bubble; on submit fires `onAction` with `{action: submitAction,
 * payload: {purpose, captured}}` so the host posts the next chat turn.
 *
 * LitFin rhythm: bordered card, labels above inputs, single primary
 * submit. Fields are typed text / number / date / select / amount-tzs /
 * pml-picker / site-picker — the latter two render as text fallback for
 * now (the cockpit replaces them with picker drawers once wired).
 */

import { useState, type ReactElement } from 'react';

type FieldKind =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'pml-picker'
  | 'site-picker'
  | 'amount-tzs';

interface CaptureField {
  readonly key?: string;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?: FieldKind;
  readonly options?: ReadonlyArray<string>;
  readonly required?: boolean;
  readonly placeholder?: string;
}

export interface DataCaptureCardBlock {
  readonly type: 'data_capture_card';
  readonly purpose?: string;
  readonly fields?: ReadonlyArray<CaptureField>;
  readonly submitAction?: string;
  readonly [extra: string]: unknown;
}

export interface DataCaptureCardBlockProps {
  readonly block: DataCaptureCardBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: {
      readonly purpose: string;
      readonly captured: Record<string, string>;
    };
  }) => void;
}

function inputType(kind: FieldKind | undefined): string {
  if (kind === 'number' || kind === 'amount-tzs') return 'number';
  if (kind === 'date') return 'date';
  return 'text';
}

function labelFor(field: CaptureField, locale: 'sw' | 'en'): string {
  const lab =
    (locale === 'sw' ? field.label?.sw : field.label?.en) ??
    field.label?.en ??
    field.label?.sw ??
    field.key ??
    '';
  return lab;
}

export function DataCaptureCardBlock({
  block,
  locale,
  onAction,
}: DataCaptureCardBlockProps): ReactElement {
  const fields = Array.isArray(block.fields)
    ? block.fields.filter((f): f is CaptureField => Boolean(f) && typeof f === 'object').slice(0, 3)
    : [];
  const purpose = typeof block.purpose === 'string' ? block.purpose : '';
  const submitAction =
    typeof block.submitAction === 'string' ? block.submitAction : '';

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || submitAction.length === 0) return;
    setSubmitting(true);
    try {
      onAction?.({
        action: submitAction,
        payload: { purpose, captured: values },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="inline-block-data-capture-card"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <p className="text-tiny font-medium uppercase tracking-wide text-info">
        {locale === 'sw' ? 'Kukusanya' : 'Quick capture'}
      </p>
      {purpose ? (
        <p className="mt-1 text-sm text-foreground">{purpose}</p>
      ) : null}
      <div className="mt-3 space-y-2.5">
        {fields.map((field, i) => {
          const key = typeof field.key === 'string' ? field.key : `field_${i}`;
          const kind = field.kind ?? 'text';
          const lab = labelFor(field, locale);
          const placeholder =
            typeof field.placeholder === 'string' ? field.placeholder : '';
          const required = field.required !== false;

          if (kind === 'select' && Array.isArray(field.options)) {
            return (
              <label key={key} className="block text-sm">
                <span className="block text-tiny font-medium text-foreground/80">
                  {lab}
                </span>
                <select
                  required={required}
                  value={values[key] ?? ''}
                  onChange={(e) =>
                    setValues({ ...values, [key]: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">{placeholder || (locale === 'sw' ? 'Chagua' : 'Select')}</option>
                  {field.options.map((opt) => (
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
                type={inputType(kind)}
                required={required}
                placeholder={placeholder}
                value={values[key] ?? ''}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
          );
        })}
      </div>
      <button
        type="submit"
        disabled={submitting || submitAction.length === 0}
        className="mt-3 w-full rounded-lg bg-warning px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {locale === 'sw' ? 'Tuma' : 'Send'}
      </button>
    </form>
  );
}
