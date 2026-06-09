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
 * owner-genui-2 fix: file_upload / image_upload / audio_note wire onChange to
 * a tab-scoped signed-URL upload endpoint so the URL string enters the form
 * bag. signature uses FileReader to produce a base64 data:image/ string (as
 * required by the registry's signature schema). Both paths call bind.onChange
 * once resolved. Upload state is tracked locally (idle → uploading → done/
 * error) so the control shows honest progress and is disabled mid-upload.
 *
 * owner-genui-3 fix: address_with_map renders a two-line structured address
 * input (free-text address + lat/lng) that serialises to a JSON string, so the
 * gateway receives a parseable structured value instead of an opaque string.
 *
 * All label/help text is sanitised to plain text via `toSafeText`
 * (CLAUDE.md: no raw HTML interpolation).
 */

import { type ChangeEvent, useRef, useState, type ReactElement } from 'react';
import { API_BASE, ApiError } from '@/lib/api-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getFieldKindMetadata, type PortalTabField } from '@borjie/portal-genui';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';

import { toSafeText } from './sanitize';
import {
  useGenuiFormField,
  type GenuiFieldValue,
  type GenuiFormFieldBinding,
} from './genui-form-context';

interface GenUIFieldRendererProps {
  readonly field: PortalTabField;
  /**
   * Tab id — present in fetched-tab mode, null in preview mode.
   * Needed to scope file uploads to the correct tab (owner-genui-2).
   */
  readonly tabId?: string | null;
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
  tabId: string | null | undefined,
  t: TFn,
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
    case 'audio_note':
      // owner-genui-2: upload binary to a signed Supabase Storage URL
      // (POST /api/v1/portal-genui/tabs/:id/upload → { url }) then store the
      // URL string as the field value via bind.onChange. This makes the file
      // value travel through the same form bag as all other fields.
      return (
        <FileUploadControl
          id={id}
          field={field}
          bind={bind}
          tabId={tabId ?? null}
          disabled={disabled}
          accept={field.accept && field.accept.length > 0 ? field.accept.join(',') : undefined}
          t={t}
        />
      );
    case 'signature':
      // owner-genui-2: signature uses FileReader to produce a base64
      // data:image/ string (the registry validates signatures as a base64
      // data URI, NOT a URL — different from the other three file kinds).
      return (
        <SignatureControl
          id={id}
          field={field}
          bind={bind}
          disabled={disabled}
          t={t}
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
      // owner-genui-3: render a structured address input — free-text address
      // + optional lat/lng — serialised as a JSON string so downstream
      // consumers can parse {address, lat, lng}. Using a typed structured
      // capture beats a free-form string for mining fleet/ESG use cases.
      return (
        <AddressWithMapControl
          id={id}
          bind={bind}
          placeholder={placeholder}
          disabled={disabled}
          t={t}
        />
      );
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

// ── File upload controls (owner-genui-2) ───────────────────────────────────

type UploadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading' }
  | { readonly kind: 'done'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * FileUploadControl — file / image / audio upload that POSTs the binary to
 * POST /api/v1/portal-genui/tabs/:tabId/upload (returns { url: string }) and
 * stores the resulting URL in the form bag via bind.onChange.
 *
 * When tabId is null (preview mode) or the upload endpoint fails, a clear
 * error is shown so the user understands the field is not silently no-oping.
 */
function FileUploadControl({
  id,
  field,
  bind,
  tabId,
  disabled,
  accept,
  t,
}: {
  readonly id: string;
  readonly field: PortalTabField;
  readonly bind: GenuiFormFieldBinding;
  readonly tabId: string | null;
  readonly disabled: boolean;
  // `| undefined` so the JSX `accept={cond ? '...' : undefined}` passes verbatim
  // under exactOptionalPropertyTypes.
  readonly accept?: string | undefined;
  readonly t: TFn;
}): ReactElement {
  const [uploadState, setUploadState] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!tabId) {
      setUploadState({ kind: 'error', message: t('genuiTab.fieldUploadPreviewDisabled') });
      return;
    }
    setUploadState({ kind: 'uploading' });
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fieldKey', field.key);

      // Use native fetch for multipart/form-data — apiRequest always
      // JSON-stringifies its body and cannot carry FormData.
      const authHeaders: Record<string, string> = {};
      if (typeof window !== 'undefined') {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) authHeaders.Authorization = `Bearer ${token}`;
        } catch {
          // fail-open: let the gateway respond 401 if unauthed
        }
      }

      const url = `${API_BASE.replace(/\/+$/, '')}/api/v1/portal-genui/tabs/${encodeURIComponent(tabId)}/upload`;
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', ...authHeaders },
        body: formData,
      });

      if (!response.ok) {
        throw new ApiError(
          `Upload failed with HTTP ${response.status}`,
          response.status,
        );
      }

      const json = (await response.json()) as { success?: boolean; data?: { url?: string }; url?: string };
      // Gateway wraps in {success, data} envelope or returns {url} directly.
      const uploadedUrl =
        (json.data?.url ?? json.url ?? '') as string;
      if (!uploadedUrl) throw new Error('upload returned no url');

      bind.onChange(uploadedUrl);
      setUploadState({ kind: 'done', url: uploadedUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('genuiTab.fieldUploadFailed');
      setUploadState({ kind: 'error', message });
      // Reset the input so the user can retry.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const isUploading = uploadState.kind === 'uploading';
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        id={id}
        type="file"
        className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground disabled:opacity-60"
        disabled={disabled || isUploading}
        accept={accept}
        onChange={(e) => {
          void handleChange(e);
        }}
      />
      {isUploading ? (
        <span className="text-xs text-neutral-400">{t('genuiTab.fieldUploading')}</span>
      ) : null}
      {uploadState.kind === 'done' ? (
        <span className="text-xs text-success">{t('genuiTab.fieldUploaded')}</span>
      ) : null}
      {uploadState.kind === 'error' ? (
        <span className="text-xs text-destructive">{uploadState.message}</span>
      ) : null}
    </div>
  );
}

/**
 * SignatureControl — reads the selected file via FileReader and calls
 * bind.onChange with a base64 data:image/ string (the registry's signature
 * schema validates this shape, NOT a remote URL).
 */
function SignatureControl({
  id,
  field: _field,
  bind,
  disabled,
  t,
}: {
  readonly id: string;
  readonly field: PortalTabField;
  readonly bind: GenuiFormFieldBinding;
  readonly disabled: boolean;
  readonly t: TFn;
}): ReactElement {
  const [status, setStatus] = useState<'idle' | 'reading' | 'done' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('reading');
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        bind.onChange(dataUrl);
        setStatus('done');
      } else {
        setStatus('error');
        if (inputRef.current) inputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setStatus('error');
      if (inputRef.current) inputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground disabled:opacity-60"
        disabled={disabled || status === 'reading'}
        onChange={handleChange}
      />
      {status === 'reading' ? (
        <span className="text-xs text-neutral-400">{t('genuiTab.fieldReadingSignature')}</span>
      ) : null}
      {status === 'done' ? (
        <span className="text-xs text-success">{t('genuiTab.fieldSignatureCaptured')}</span>
      ) : null}
      {status === 'error' ? (
        <span className="text-xs text-destructive">
          {t('genuiTab.fieldSignatureReadError')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * AddressWithMapControl — structured address + lat/lng capture
 * (owner-genui-3). Serialises to a JSON string: { address, lat, lng } so
 * the gateway receives a machine-parseable value suitable for mining fleet
 * routing and ESG footprint calculations.
 */
function AddressWithMapControl({
  id,
  bind,
  placeholder,
  disabled,
  t,
}: {
  readonly id: string;
  readonly bind: GenuiFormFieldBinding;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly t: TFn;
}): ReactElement {
  // Parse the current JSON string back to fields for controlled editing.
  const currentJson = typeof bind.value === 'string' ? bind.value : '';
  let parsed: { address?: string; lat?: string; lng?: string } = {};
  try {
    if (currentJson) parsed = JSON.parse(currentJson) as typeof parsed;
  } catch {
    // malformed stored value — treat as empty
  }

  const update = (patch: Partial<typeof parsed>): void => {
    const next = { ...parsed, ...patch };
    bind.onChange(JSON.stringify(next));
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        id={id}
        type="text"
        className={BASE_INPUT_CLASS}
        placeholder={placeholder || t('genuiTab.fieldAddressPlaceholder')}
        disabled={disabled}
        value={parsed.address ?? ''}
        onChange={(e) => update({ address: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          id={`${id}-lat`}
          type="number"
          step="any"
          className={`${BASE_INPUT_CLASS} flex-1`}
          placeholder={t('genuiTab.fieldLatitude')}
          disabled={disabled}
          value={parsed.lat ?? ''}
          onChange={(e) => update({ lat: e.target.value })}
        />
        <input
          id={`${id}-lng`}
          type="number"
          step="any"
          className={`${BASE_INPUT_CLASS} flex-1`}
          placeholder={t('genuiTab.fieldLongitude')}
          disabled={disabled}
          value={parsed.lng ?? ''}
          onChange={(e) => update({ lng: e.target.value })}
        />
      </div>
    </div>
  );
}

export function GenUIFieldRenderer({
  field,
  tabId,
}: GenUIFieldRendererProps): ReactElement {
  // The registry is the source of truth for the human label/description; we
  // fall back to the field's own label when the kind is somehow unmapped.
  const meta = getFieldKindMetadata(field.kind);
  const label = toSafeText(field.label) || meta.displayLabel;
  const help = toSafeText(field.help);
  // Bind to the host's form state. Uncontrolled (no-op) in preview mode.
  const bind = useGenuiFormField(field.key);
  // Locale-strict translator — drives all status/label copy so the field
  // renders in exactly one language (en or sw) matching the active locale.
  const t = useT();

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
      {renderControl(field, bind, tabId, t)}
      {help ? <p className="text-xs text-neutral-400">{help}</p> : null}
    </div>
  );
}
