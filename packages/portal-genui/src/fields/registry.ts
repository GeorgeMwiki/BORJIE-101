/**
 * Field-type catalog — the 22 supported field kinds and their
 * metadata (renderer name, validator, default props, mock value).
 *
 * The renderer name is a string the React layer maps to a component
 * (`DynamicFieldRenderer.tsx`). Keeping the mapping as a string
 * means this package stays React-free and works in the api-gateway
 * and Node-side tests.
 */

import { z } from 'zod';
import {
  PORTAL_TAB_FIELD_KINDS,
  type PortalTabField,
  type PortalTabFieldKind,
} from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Per-kind metadata
// ────────────────────────────────────────────────────────────────────

export interface FieldKindMetadata {
  readonly kind: PortalTabFieldKind;
  /** React component name in the admin-portal renderer registry. */
  readonly rendererName: string;
  /** Human label shown in the tab-builder UI. */
  readonly displayLabel: string;
  /** Brief description shown as a tooltip in the tab-builder UI. */
  readonly description: string;
  /** Default props the field uses when the generator doesn't specify. */
  readonly defaultProps: Readonly<Partial<PortalTabField>>;
  /** A representative mock value used in preview cards. */
  readonly mockValue: unknown;
  /**
   * Build the value validator for an INSTANCE of this field (i.e. a
   * concrete `PortalTabField`). Used by the API + the renderer to
   * reject bad submissions.
   */
  readonly buildValueValidator: (field: PortalTabField) => z.ZodTypeAny;
}

// ────────────────────────────────────────────────────────────────────
// Helpers — shared validator fragments.
// ────────────────────────────────────────────────────────────────────

function maybeRequired<T extends z.ZodTypeAny>(
  field: PortalTabField,
  schema: T,
): z.ZodTypeAny {
  if (field.required) return schema;
  return schema.optional().nullable();
}

function clampNumber(field: PortalTabField, schema: z.ZodNumber): z.ZodNumber {
  let out = schema;
  if (typeof field.min === 'number') out = out.min(field.min);
  if (typeof field.max === 'number') out = out.max(field.max);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<PortalTabFieldKind, FieldKindMetadata>> = {
  text: {
    kind: 'text',
    rendererName: 'TextInput',
    displayLabel: 'Text',
    description: 'Single-line free text up to 500 characters.',
    defaultProps: { span: 6 },
    mockValue: 'Example text',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().min(1).max(500)),
  },
  long_text: {
    kind: 'long_text',
    rendererName: 'TextareaInput',
    displayLabel: 'Long text',
    description: 'Multi-line free text up to 4000 characters.',
    defaultProps: { span: 12 },
    mockValue: 'A longer paragraph of free-text content.',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().min(1).max(4000)),
  },
  number: {
    kind: 'number',
    rendererName: 'NumberInput',
    displayLabel: 'Number',
    description: 'Plain numeric value with optional min / max bounds.',
    defaultProps: { span: 4, precision: 0 },
    mockValue: 42,
    buildValueValidator: (field) => maybeRequired(field, clampNumber(field, z.number())),
  },
  currency: {
    kind: 'currency',
    rendererName: 'CurrencyInput',
    displayLabel: 'Currency',
    description: 'Currency-formatted numeric value with ISO 4217 code.',
    defaultProps: { span: 4, precision: 2 },
    mockValue: 1234.56,
    buildValueValidator: (field) =>
      maybeRequired(field, clampNumber(field, z.number()).nonnegative()),
  },
  percent: {
    kind: 'percent',
    rendererName: 'PercentInput',
    displayLabel: 'Percent',
    description: 'Percentage as a number between 0 and 100.',
    defaultProps: { span: 3, precision: 1, min: 0, max: 100 },
    mockValue: 76.5,
    buildValueValidator: (field) =>
      maybeRequired(field, clampNumber(field, z.number()).min(0).max(100)),
  },
  date: {
    kind: 'date',
    rendererName: 'DateInput',
    displayLabel: 'Date',
    description: 'Calendar date (no time component).',
    defaultProps: { span: 4 },
    mockValue: '2026-05-24',
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .string()
          .min(1)
          .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), 'must be YYYY-MM-DD'),
      ),
  },
  datetime: {
    kind: 'datetime',
    rendererName: 'DateTimeInput',
    displayLabel: 'Date + time',
    description: 'Calendar date with time-of-day.',
    defaultProps: { span: 4 },
    mockValue: '2026-05-24T09:30:00.000Z',
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .string()
          .min(1)
          .refine(
            (s) => !Number.isNaN(Date.parse(s)),
            'must be ISO-8601 parseable',
          ),
      ),
  },
  dropdown: {
    kind: 'dropdown',
    rendererName: 'DropdownInput',
    displayLabel: 'Dropdown',
    description: 'Pick exactly one of N enumerated options.',
    defaultProps: { span: 4 },
    mockValue: 'option_a',
    buildValueValidator: (field) => {
      const values = (field.options ?? []).map((o) => o.value);
      if (values.length === 0) return z.never();
      return maybeRequired(field, z.enum(values as [string, ...string[]]));
    },
  },
  multi_select: {
    kind: 'multi_select',
    rendererName: 'MultiSelectInput',
    displayLabel: 'Multi-select',
    description: 'Pick zero or more of N enumerated options.',
    defaultProps: { span: 6 },
    mockValue: ['option_a', 'option_b'],
    buildValueValidator: (field) => {
      const values = (field.options ?? []).map((o) => o.value);
      if (values.length === 0) return z.never();
      return maybeRequired(
        field,
        z.array(z.enum(values as [string, ...string[]])).max(values.length),
      );
    },
  },
  checkbox: {
    kind: 'checkbox',
    rendererName: 'CheckboxInput',
    displayLabel: 'Checkbox',
    description: 'Boolean check / uncheck.',
    defaultProps: { span: 3 },
    mockValue: true,
    buildValueValidator: (field) => maybeRequired(field, z.boolean()),
  },
  toggle: {
    kind: 'toggle',
    rendererName: 'ToggleInput',
    displayLabel: 'Toggle',
    description: 'Boolean toggle / switch.',
    defaultProps: { span: 3 },
    mockValue: false,
    buildValueValidator: (field) => maybeRequired(field, z.boolean()),
  },
  file_upload: {
    kind: 'file_upload',
    rendererName: 'FileUpload',
    displayLabel: 'File upload',
    description: 'Upload one file. Stored as a signed URL.',
    defaultProps: { span: 6, accept: ['application/pdf'] },
    mockValue: 'https://files.example.com/sample.pdf',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().url().max(2048)),
  },
  image_upload: {
    kind: 'image_upload',
    rendererName: 'ImageUpload',
    displayLabel: 'Image upload',
    description: 'Upload one image. Stored as a signed URL.',
    defaultProps: { span: 6, accept: ['image/png', 'image/jpeg'] },
    mockValue: 'https://files.example.com/sample.png',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().url().max(2048)),
  },
  signature: {
    kind: 'signature',
    rendererName: 'SignaturePadField',
    displayLabel: 'Signature',
    description: 'Captured signature as a base64-encoded PNG.',
    defaultProps: { span: 6 },
    mockValue: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .string()
          .min(1)
          .max(2_000_000) // ~1.5 MB base64
          .startsWith('data:image/'),
      ),
  },
  address_with_map: {
    kind: 'address_with_map',
    rendererName: 'AddressWithMap',
    displayLabel: 'Address (with map)',
    description: 'Free-text address + lat/lon pin.',
    defaultProps: { span: 12 },
    mockValue: {
      address: '1 Example St, Dar es Salaam',
      lat: -6.7924,
      lon: 39.2083,
    },
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .object({
            address: z.string().min(1).max(500),
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
          })
          .strict(),
      ),
  },
  audio_note: {
    kind: 'audio_note',
    rendererName: 'AudioNote',
    displayLabel: 'Audio note',
    description: 'Recorded audio clip stored as a signed URL.',
    defaultProps: { span: 6, accept: ['audio/webm', 'audio/mpeg'] },
    mockValue: 'https://files.example.com/note.mp3',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().url().max(2048)),
  },
  phone_number: {
    kind: 'phone_number',
    rendererName: 'PhoneInput',
    displayLabel: 'Phone number',
    description: 'E.164-style phone number.',
    defaultProps: { span: 4 },
    mockValue: '+255712345678',
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .string()
          .min(7)
          .max(20)
          .regex(/^\+?[0-9 ()-]{6,19}$/, 'invalid phone format'),
      ),
  },
  email: {
    kind: 'email',
    rendererName: 'EmailInput',
    displayLabel: 'Email',
    description: 'Single email address.',
    defaultProps: { span: 6 },
    mockValue: 'jane@example.com',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().email().max(320)),
  },
  url: {
    kind: 'url',
    rendererName: 'UrlInput',
    displayLabel: 'URL',
    description: 'HTTPS URL.',
    defaultProps: { span: 6 },
    mockValue: 'https://example.com',
    buildValueValidator: (field) =>
      maybeRequired(field, z.string().url().max(2048)),
  },
  json: {
    kind: 'json',
    rendererName: 'JsonEditor',
    displayLabel: 'JSON',
    description: 'Free-form JSON object — power-user only.',
    defaultProps: { span: 12 },
    mockValue: { example: true },
    buildValueValidator: (field) =>
      maybeRequired(field, z.record(z.unknown())),
  },
  rating: {
    kind: 'rating',
    rendererName: 'RatingInput',
    displayLabel: 'Rating',
    description: 'Integer rating, 1 to N.',
    defaultProps: { span: 3, min: 1, max: 5 },
    mockValue: 4,
    buildValueValidator: (field) =>
      maybeRequired(field, clampNumber(field, z.number().int())),
  },
  color: {
    kind: 'color',
    rendererName: 'ColorInput',
    displayLabel: 'Color',
    description: 'Hex color code.',
    defaultProps: { span: 3 },
    mockValue: '#3b82f6',
    buildValueValidator: (field) =>
      maybeRequired(
        field,
        z
          .string()
          .min(4)
          .max(9)
          .regex(/^#[0-9a-fA-F]{3,8}$/, 'must be a hex color'),
      ),
  },
};

// ────────────────────────────────────────────────────────────────────
// Public surface
// ────────────────────────────────────────────────────────────────────

export const FIELD_KIND_REGISTRY = REGISTRY;

export const ALL_FIELD_KINDS: ReadonlyArray<PortalTabFieldKind> =
  PORTAL_TAB_FIELD_KINDS;

export function getFieldKindMetadata(
  kind: PortalTabFieldKind,
): FieldKindMetadata {
  const meta = REGISTRY[kind];
  if (!meta) {
    throw new Error(`[portal-genui] unknown field kind '${kind}'`);
  }
  return meta;
}

export function buildFieldValueValidator(
  field: PortalTabField,
): z.ZodTypeAny {
  return getFieldKindMetadata(field.kind).buildValueValidator(field);
}

/**
 * Construct a mock record matching a tab's field layout. Useful in
 * the tab-builder preview before any user data exists.
 */
export function buildMockRecordForFields(
  fields: ReadonlyArray<PortalTabField>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.key] = getFieldKindMetadata(field.kind).mockValue;
  }
  return out;
}
