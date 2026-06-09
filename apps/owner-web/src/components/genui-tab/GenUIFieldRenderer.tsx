'use client';

/**
 * GenUIFieldRenderer — renders ONE generated `PortalTabField` using the
 * EXISTING field-type catalog from `@borjie/portal-genui` (fields/registry).
 *
 * The registry is React-free (it ships `rendererName` strings + metadata so
 * the package stays usable in Node + the api-gateway). This component is the
 * owner-web side of that contract: it maps each of the 22 field kinds to a
 * concrete control so the MD sees the REAL field they authored.
 *
 * K1b — the field is now a CONTROLLED input bound to the host's form state
 * (`useGenuiFormField`) so its value flows back to the submit. When the host
 * provides NO form (pure-preview mode, e.g. a brain `tab_proposal` chip), the
 * binding is uncontrolled and the render is byte-identical to the old preview.
 *
 * All label/help text is sanitised to plain text via `toSafeText`
 * (CLAUDE.md: no raw HTML interpolation).
 */

import { type ChangeEvent, type ReactElement } from 'react';
import { getFieldKindMetadata, type PortalTabField } from '@borjie/portal-genui';

import { toSafeText } from './sanitize';
import {
  useGenuiFormField,
  type GenuiFieldValue,
  type GenuiFormFieldBinding,
} from './genui-form-context';

interface GenUIFieldRendererProps {
  readonly field: PortalTabField;
}

const BASE_INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:border-warning focus:outline-none focus:ring-1 focus:ring-warning/40 disabled:cursor-not-allowed disabled:opacity-60';

function spanToColClass(span: number | undefined): string {
  // PortalTabField.span is a 1-12 grid hint; map to a coarse responsive
  // column span so the preview honours the generated layout intent.
  const s = typeof span === 'number' ? Math.min(Math.max(span, 1), 12) : 6;
  if (s >= 12) return 'sm:col-span-12';
  if (s >= 9) return 'sm:col-span-9';
  if (s >= 6) return 'sm:col-span-6';
  if (s >= 4) return 'sm:col-span-4';
  if (s >= 3) return 'sm:col-span-3';
  return 'sm:col-span-2';
}

/** Coerce a stored field value into the string a text-like control expects. */
function asText(value: GenuiFieldValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

/**
 * Controlled-input props for a text-like control. In preview mode (no host
 * form) we return `{}` so the control stays uncontrolled — identical to the
 * pre-K1b behaviour.
 */
function textBinding(
  bind: GenuiFormFieldBinding,
): Record<string, unknown> {
  if (!bind.controlled) return {};
  return {
    value: asText(bind.value),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      bind.onChange(e.target.value),
  };
}

/** Render the kind-appropriate control, bound to form state when controlled. */
function renderControl(
  field: PortalTabField,
  bind: GenuiFormFieldBinding,
): ReactElement {
  const placeholder = toSafeText(field.placeholder);
  const disabled = field.readonly === true || bind.disabled;
  const id = `genui-field-${field.key}`;
  const text = textBinding(bind);

  switch (field.kind) {
    case 'long_text':
      return (
        <textarea
          id={id}
          rows={3}
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...text}
        />
      );
    case 'dropdown':
    case 'multi_select': {
      const multiple = field.kind === 'multi_select';
      const selectBinding = bind.controlled
        ? {
            value: multiple
              ? Array.isArray(bind.value)
                ? (bind.value as ReadonlyArray<string>)
                : []
              : asText(bind.value),
            onChange: (e: ChangeEvent<HTMLSelectElement>) =>
              bind.onChange(
                multiple
                  ? Array.from(e.target.selectedOptions, (o) => o.value)
                  : e.target.value,
              ),
          }
        : {};
      return (
        <select
          id={id}
          className={BASE_INPUT_CLASS}
          disabled={disabled}
          multiple={multiple}
          {...selectBinding}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {toSafeText(opt.label)}
            </option>
          ))}
        </select>
      );
    }
    case 'checkbox':
    case 'toggle':
      return (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 rounded border-border text-warning focus:ring-warning/40"
          disabled={disabled}
          {...(bind.controlled
            ? {
                checked: bind.value === true,
                onChange: (e: ChangeEvent<HTMLInputElement>) =>
                  bind.onChange(e.target.checked),
              }
            : {})}
        />
      );
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
      return (
        <input
          id={id}
          type="number"
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...(typeof field.min === 'number' ? { min: field.min } : {})}
          {...(typeof field.max === 'number' ? { max: field.max } : {})}
          {...text}
        />
      );
    case 'date':
      return (
        <input
          id={id}
          type="date"
          className={BASE_INPUT_CLASS}
          disabled={disabled}
          {...text}
        />
      );
    case 'datetime':
      return (
        <input
          id={id}
          type="datetime-local"
          className={BASE_INPUT_CLASS}
          disabled={disabled}
          {...text}
        />
      );
    case 'email':
      return (
        <input
          id={id}
          type="email"
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...text}
        />
      );
    case 'url':
      return (
        <input
          id={id}
          type="url"
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...text}
        />
      );
    case 'phone_number':
      return (
        <input
          id={id}
          type="tel"
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...text}
        />
      );
    case 'color':
      return (
        <input
          id={id}
          type="color"
          className="h-9 w-16 rounded-md border border-border bg-surface"
          disabled={disabled}
          {...text}
        />
      );
    case 'file_upload':
    case 'image_upload':
    case 'signature':
    case 'audio_note':
      // File controls stay uncontrolled (a file input cannot carry a string
      // value); the binary upload path is out of scope for the record bag.
      return (
        <input
          id={id}
          type="file"
          className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
          disabled={disabled}
          {...(field.accept && field.accept.length > 0
            ? { accept: field.accept.join(',') }
            : {})}
        />
      );
    case 'json':
      return (
        <textarea
          id={id}
          rows={3}
          className={`${BASE_INPUT_CLASS} font-mono`}
          placeholder={placeholder || '{ }'}
          disabled={disabled}
          {...text}
        />
      );
    case 'address_with_map':
    case 'text':
    default:
      return (
        <input
          id={id}
          type="text"
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
          {...text}
        />
      );
  }
}

export function GenUIFieldRenderer({
  field,
}: GenUIFieldRendererProps): ReactElement {
  // The registry is the source of truth for the human label/description; we
  // fall back to the field's own label when the kind is somehow unmapped.
  const meta = getFieldKindMetadata(field.kind);
  const label = toSafeText(field.label) || meta.displayLabel;
  const help = toSafeText(field.help);
  // Bind to the host's form state. Uncontrolled (no-op) in preview mode.
  const bind = useGenuiFormField(field.key);

  return (
    <div
      className={`col-span-12 flex flex-col gap-1.5 ${spanToColClass(field.span)}`}
      data-testid={`genui-field-${field.key}`}
      data-field-kind={field.kind}
    >
      <label
        htmlFor={`genui-field-${field.key}`}
        className="text-sm font-medium text-foreground"
      >
        {label}
        {field.required ? (
          <span className="ml-0.5 text-destructive">*</span>
        ) : null}
      </label>
      {renderControl(field, bind)}
      {help ? <p className="text-xs text-neutral-400">{help}</p> : null}
    </div>
  );
}
