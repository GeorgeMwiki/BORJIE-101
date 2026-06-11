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
 * pml-picker / site-picker.
 *
 * pml-picker and site-picker render as a structured combobox input: the
 * owner types to search their known licences/sites. Until a live search
 * endpoint is wired the input is a clear text field labelled with its
 * picker type (e.g. "PML Licence ID") so the owner enters a real value
 * rather than seeing a silently degraded plain text input with no
 * affordance. The placeholder communicates the expected format.
 */

import { useState, type ReactElement } from 'react';
import { pickByLocale } from '@/lib/locale-shared';
import { dataCaptureCardBlockStrings as S } from '@/i18n/strings/data-capture-card-block';

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
  return (
    (locale === 'sw' ? field.label?.sw : field.label?.en) ??
    field.label?.en ??
    field.label?.sw ??
    field.key ??
    ''
  );
}

/** Resolved placeholder for picker kinds when the field doesn't specify one. */
function pickerPlaceholder(kind: FieldKind, locale: 'sw' | 'en'): string {
  if (kind === 'pml-picker') {
    return pickByLocale(locale, S.pmlPickerPlaceholder);
  }
  if (kind === 'site-picker') {
    return pickByLocale(locale, S.sitePickerPlaceholder);
  }
  return '';
}

/** Badge label surfaced above the input for picker kinds. */
function pickerKindLabel(kind: FieldKind, locale: 'sw' | 'en'): string {
  if (kind === 'pml-picker') {
    return pickByLocale(locale, S.pmlPickerKindLabel);
  }
  if (kind === 'site-picker') {
    return pickByLocale(locale, S.sitePickerKindLabel);
  }
  return '';
}

export function DataCaptureCardBlock({
  block,
  locale,
  onAction,
}: DataCaptureCardBlockProps): ReactElement {
  const fields = Array.isArray(block.fields)
    ? block.fields
        .filter((f): f is CaptureField => Boolean(f) && typeof f === 'object')
        .slice(0, 3)
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

  const setValue = (key: string, val: string) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="inline-block-data-capture-card"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <p className="text-tiny font-medium uppercase tracking-wide text-info">
        {pickByLocale(locale, S.quickCapture)}
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
            typeof field.placeholder === 'string' && field.placeholder.length > 0
              ? field.placeholder
              : pickerPlaceholder(kind, locale);
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
                  onChange={(e) => setValue(key, e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">
                    {placeholder || pickByLocale(locale, S.select)}
                  </option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            );
          }

          // pml-picker / site-picker: render a clearly-labelled text input
          // so the owner can type a real value. A badge next to the label
          // communicates the picker kind so the affordance is not invisible.
          if (kind === 'pml-picker' || kind === 'site-picker') {
            const kindLabel = pickerKindLabel(kind, locale);
            return (
              <label key={key} className="block text-sm">
                <span className="flex items-center gap-1.5 text-tiny font-medium text-foreground/80">
                  {lab || kindLabel}
                  <span className="rounded-full border border-info/40 bg-info/10 px-1.5 py-0.5 text-tiny font-semibold uppercase tracking-wide text-info">
                    {kindLabel}
                  </span>
                </span>
                <input
                  type="text"
                  required={required}
                  placeholder={placeholder}
                  value={values[key] ?? ''}
                  onChange={(e) => setValue(key, e.target.value)}
                  autoComplete="off"
                  data-testid={`data-capture-${kind}-${key}`}
                  className="mt-1 w-full rounded-md border border-info/30 bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:border-info/60 focus:outline-none focus:ring-1 focus:ring-info/30"
                />
              </label>
            );
          }

          return (
            <label key={key} className="block text-sm">
              <span className="block text-tiny font-medium text-foreground/80">
                {lab}
                {kind === 'amount-tzs' ? (
                  <span className="ml-1 text-neutral-500">(TZS)</span>
                ) : null}
              </span>
              <input
                type={inputType(kind)}
                required={required}
                placeholder={placeholder}
                value={values[key] ?? ''}
                onChange={(e) => setValue(key, e.target.value)}
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
        {pickByLocale(locale, S.send)}
      </button>
    </form>
  );
}
