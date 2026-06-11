'use client';

/**
 * genui-form-context — the form-state seam shared by the host (writer) and the
 * field renderers (readers).
 *
 * The host owns a single value bag keyed by the field's stable key; each
 * `GenUIFieldRenderer` becomes a CONTROLLED input bound to that bag so every
 * value flows back to the host's submit. This is generative — the bag has no
 * per-field shape; it is just `Record<fieldKey, value>` populated as the user
 * types.
 *
 * When a tab is a pure preview (no record submission), the host provides NO
 * form context; `useGenuiFormField` then returns an UNCONTROLLED stub so the
 * existing preview behaviour (read-shaped inputs) is byte-identical.
 */

import { createContext, useContext } from 'react';

/** A single field value — the union the controls produce. */
export type GenuiFieldValue = string | number | boolean | ReadonlyArray<string>;

export interface GenuiFormContextValue {
  /** Current values keyed by field key. */
  readonly values: Readonly<Record<string, GenuiFieldValue>>;
  /** Set one field's value (immutable update inside the host). */
  readonly setValue: (key: string, value: GenuiFieldValue) => void;
  /** True while a submit is in flight — controls render disabled. */
  readonly disabled: boolean;
}

/** `null` ⇒ no active form (pure-preview mode). */
export const GenUIFormContext = createContext<GenuiFormContextValue | null>(
  null,
);

export interface GenuiFormFieldBinding {
  /** True when a host form is present (field should be controlled). */
  readonly controlled: boolean;
  /** Current value for this field, or `undefined` in preview mode. */
  readonly value: GenuiFieldValue | undefined;
  /** Commit a new value (no-op in preview mode). */
  readonly onChange: (value: GenuiFieldValue) => void;
  /** True when the host has disabled the form (submit in flight). */
  readonly disabled: boolean;
}

/**
 * Bind one field to the host's form state. In preview mode (no provider) the
 * binding is uncontrolled so the field renders exactly as it did before K1b.
 */
export function useGenuiFormField(fieldKey: string): GenuiFormFieldBinding {
  const ctx = useContext(GenUIFormContext);
  if (!ctx) {
    return {
      controlled: false,
      value: undefined,
      onChange: () => {},
      disabled: false,
    };
  }
  return {
    controlled: true,
    value: ctx.values[fieldKey],
    onChange: (value) => ctx.setValue(fieldKey, value),
    disabled: ctx.disabled,
  };
}
