'use client';

/**
 * DraftEditBlock — inline form for customizing a draft before lock.
 *
 * Schema source: `packages/owner-os-tabs/src/draft-edit-block.ts`.
 * Renders editable fields with current values pre-filled; owner adjusts
 * then clicks "Save revision" (new editable revision) or "Save and lock"
 * (locks + warns about immutability).
 *
 * Supports: text, textarea, number, date, select, currency-tzs,
 * party-picker, site-picker, licence-picker.
 */

import { useState, type ReactElement } from 'react';
import type { DraftEditBlock } from '@borjie/owner-os-tabs';

type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'currency-tzs'
  | 'party-picker'
  | 'site-picker'
  | 'licence-picker';

export interface DraftEditBlockProps {
  readonly block: DraftEditBlock & Record<string, unknown>;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: {
      readonly draftId: string;
      readonly revisionNo: number;
      readonly fields: Record<string, unknown>;
    };
  }) => void;
}

function inputType(kind: FieldKind | undefined): string {
  if (kind === 'number' || kind === 'currency-tzs') return 'number';
  if (kind === 'date') return 'date';
  return 'text';
}

function labelFor(field: unknown, locale: 'sw' | 'en'): string {
  if (typeof field !== 'object' || !field) return '';
  const f = field as Record<string, unknown>;
  const label = f.label as { en?: string; sw?: string } | undefined;
  const lab =
    (locale === 'sw' ? label?.sw : label?.en) ??
    label?.en ??
    label?.sw ??
    (f.key as string | undefined) ??
    '';
  return lab;
}

function helperFor(field: unknown, locale: 'sw' | 'en'): string {
  if (typeof field !== 'object' || !field) return '';
  const f = field as Record<string, unknown>;
  const helperText = f.helperText as { en?: string; sw?: string } | undefined;
  const help =
    (locale === 'sw' ? helperText?.sw : helperText?.en) ??
    helperText?.en ??
    helperText?.sw ??
    '';
  return help;
}

function stringValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
}

function getFieldKind(f: unknown): FieldKind {
  if (typeof f !== 'object' || !f) return 'text';
  const field = f as Record<string, unknown>;
  const k = field.kind as unknown;
  if (typeof k === 'string') return k as FieldKind;
  return 'text';
}

export function DraftEditBlock({
  block,
  locale,
  onAction,
}: DraftEditBlockProps): ReactElement {
  const fields = Array.isArray(block.fields) ? block.fields.slice(0, 20) : [];

  const draftId = typeof block.draftId === 'string' ? block.draftId : '';
  const revisionNo = typeof block.revisionNo === 'number' ? block.revisionNo : 1;

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      if (typeof f === 'object' && f) {
        const field = f as Record<string, unknown>;
        const key = typeof field.key === 'string' ? field.key : `field_${i}`;
        init[key] = field.currentValue ?? '';
      }
    });
    return init;
  });

  const [submitting, setSubmitting] = useState(false);
  const [showLockWarning, setShowLockWarning] = useState(false);

  const handleSaveRevision = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !draftId) return;
    setSubmitting(true);
    try {
      onAction?.({
        action: 'save_revision',
        payload: { draftId, revisionNo, fields: values },
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndLock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftId) return;
    setShowLockWarning(true);
  };

  const confirmLock = () => {
    if (submitting || !draftId) return;
    setSubmitting(true);
    setShowLockWarning(false);
    try {
      onAction?.({
        action: 'save_and_lock',
        payload: { draftId, revisionNo, fields: values },
      });
    } finally {
      setSubmitting(false);
    }
  };

  const primaryAction = block.primaryAction as unknown as { kind?: string; label?: { en?: string; sw?: string } };
  const primaryLabel =
    locale === 'sw'
      ? primaryAction?.label?.sw ?? 'Save'
      : primaryAction?.label?.en ?? 'Save';

  const warning = block.warning as unknown as { en?: string; sw?: string };
  const warningText =
    locale === 'sw'
      ? warning?.sw ?? 'Locking makes this revision immutable. Future edits create new revisions.'
      : warning?.en ?? 'Locking makes this revision immutable. Future edits create new revisions.';

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="text-tiny font-medium uppercase tracking-wide text-info">
        {locale === 'sw' ? 'Hariri' : 'Customize'}
      </p>

      {showLockWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="rounded-lg border border-border bg-surface p-4 shadow-lg max-w-sm">
            <h3 className="text-sm font-semibold text-foreground">
              {locale === 'sw' ? 'Confirm Lock' : 'Confirm Lock'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">{warningText}</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowLockWarning(false)}
                className="px-3 py-2 text-sm font-medium text-foreground hover:bg-muted rounded"
              >
                {locale === 'sw' ? 'Ghairi' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmLock}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
              >
                {locale === 'sw' ? 'Funga' : 'Lock'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSaveRevision} className="mt-3 space-y-3">
        {fields.map((field, i) => {
          if (typeof field !== 'object' || !field) return null;
          const f = field as Record<string, unknown>;
          const key = typeof f.key === 'string' ? f.key : `field_${i}`;
          const kind = getFieldKind(field);
          const lab = labelFor(field, locale);
          const help = helperFor(field, locale);
          const required = f.required === true;
          const currentVal = stringValue(values[key] ?? f.currentValue ?? '');

          const handleChange = (newVal: string) => {
            setValues((prev) => ({ ...prev, [key]: newVal }));
          };

          return (
            <div key={key}>
              {lab ? (
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  {lab}
                  {required ? <span className="text-destructive">*</span> : null}
                </label>
              ) : null}

              {kind === 'textarea' ? (
                <textarea
                  value={currentVal}
                  onChange={(e) => handleChange(e.target.value)}
                  required={required}
                  className="w-full px-2.5 py-2 rounded border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={4}
                />
              ) : kind === 'select' ? (
                <select
                  value={currentVal}
                  onChange={(e) => handleChange(e.target.value)}
                  required={required}
                  className="w-full px-2.5 py-2 rounded border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">{locale === 'sw' ? 'Chagua' : 'Select'}</option>
                  {Array.isArray(f.options) &&
                    f.options.map((opt) => (
                      <option key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type={inputType(kind)}
                  value={currentVal}
                  onChange={(e) => handleChange(e.target.value)}
                  required={required}
                  className="w-full px-2.5 py-2 rounded border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              )}

              {help ? (
                <p className="mt-1 text-xs text-muted-foreground">{help}</p>
              ) : null}
            </div>
          );
        })}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
          >
            {primaryLabel}
          </button>

          {primaryAction?.kind === 'save_and_lock' ? (
            <button
              type="button"
              onClick={handleSaveAndLock}
              disabled={submitting}
              className="flex-1 px-3 py-2 text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 rounded disabled:opacity-50"
            >
              {locale === 'sw' ? 'Funga' : 'Lock'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
