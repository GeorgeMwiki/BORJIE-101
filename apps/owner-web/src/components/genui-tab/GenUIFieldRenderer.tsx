'use client';

/**
 * GenUIFieldRenderer — renders ONE generated `PortalTabField` using the
 * EXISTING field-type catalog from `@borjie/portal-genui` (fields/registry).
 *
 * The registry is React-free (it ships `rendererName` strings + metadata so
 * the package stays usable in Node + the api-gateway). This component is the
 * owner-web side of that contract: it maps each of the 22 field kinds to a
 * concrete control so the MD sees the REAL field they authored. It is a
 * faithful scaffold renderer (the controls are live inputs but not yet wired
 * to a submit pipeline — record persistence is a separate concern); the point
 * is an exact preview of the generated shape.
 *
 * All label/help text is sanitised to plain text via `toSafeText`
 * (CLAUDE.md: no raw HTML interpolation).
 */

import { type ReactElement } from 'react';
import { getFieldKindMetadata, type PortalTabField } from '@borjie/portal-genui';

import { toSafeText } from './sanitize';

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

/** Render the kind-appropriate control. Read-shaped preview inputs. */
function renderControl(field: PortalTabField): ReactElement {
  const placeholder = toSafeText(field.placeholder);
  const disabled = field.readonly === true;
  const id = `genui-field-${field.key}`;

  switch (field.kind) {
    case 'long_text':
      return (
        <textarea
          id={id}
          rows={3}
          className={BASE_INPUT_CLASS}
          placeholder={placeholder}
          disabled={disabled}
        />
      );
    case 'dropdown':
    case 'multi_select':
      return (
        <select
          id={id}
          className={BASE_INPUT_CLASS}
          disabled={disabled}
          multiple={field.kind === 'multi_select'}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {toSafeText(opt.label)}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
    case 'toggle':
      return (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 rounded border-border text-warning focus:ring-warning/40"
          disabled={disabled}
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
        />
      );
    case 'date':
      return (
        <input id={id} type="date" className={BASE_INPUT_CLASS} disabled={disabled} />
      );
    case 'datetime':
      return (
        <input
          id={id}
          type="datetime-local"
          className={BASE_INPUT_CLASS}
          disabled={disabled}
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
        />
      );
    case 'color':
      return (
        <input
          id={id}
          type="color"
          className="h-9 w-16 rounded-md border border-border bg-surface"
          disabled={disabled}
        />
      );
    case 'file_upload':
    case 'image_upload':
    case 'signature':
    case 'audio_note':
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
      {renderControl(field)}
      {help ? <p className="text-xs text-neutral-400">{help}</p> : null}
    </div>
  );
}
