'use client';

/**
 * use-genui-form-state — the host's immutable form value bag + submit driver.
 *
 * Collects every field value the renderers push (keyed by field key), seeds
 * defaults from the tab schema, and drives the record POST through
 * `useCreateGenuiRecord`. Generative: the bag has no per-tab shape — it is
 * built from whatever fields the generated tab declares.
 *
 * Submit flow: optimistic `submitting` → server POST → `success` (then the
 * records query is invalidated by the mutation, so the list refetches) or
 * `error`. All immutable — every value update returns a NEW bag.
 */

import { useCallback, useMemo, useState } from 'react';
import type { PortalTab } from '@borjie/portal-genui';

import {
  useCreateGenuiRecord,
  type GenuiRecordPayload,
} from '@/lib/queries/genui-records';
import type { GenuiFieldValue } from './genui-form-context';

export type GenuiSubmitStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'success' }
  | { readonly kind: 'error' };

/** Seed the value bag from the tab's field defaults (immutable). */
function seedDefaults(tab: PortalTab): Record<string, GenuiFieldValue> {
  const seed: Record<string, GenuiFieldValue> = {};
  for (const section of tab.sections) {
    for (const field of section.fields) {
      if (field.default != null) {
        seed[field.key] = field.default as GenuiFieldValue;
      } else if (field.kind === 'checkbox' || field.kind === 'toggle') {
        seed[field.key] = false;
      }
    }
  }
  return seed;
}

export interface GenuiFormState {
  readonly values: Readonly<Record<string, GenuiFieldValue>>;
  readonly setValue: (key: string, value: GenuiFieldValue) => void;
  readonly status: GenuiSubmitStatus;
  readonly submit: () => void;
  readonly disabled: boolean;
}

export function useGenuiFormState(
  tab: PortalTab,
  tabId: string | null,
): GenuiFormState {
  const initial = useMemo(() => seedDefaults(tab), [tab]);
  const [values, setValues] = useState<Record<string, GenuiFieldValue>>(initial);
  const [status, setStatus] = useState<GenuiSubmitStatus>({ kind: 'idle' });
  const mutation = useCreateGenuiRecord(tabId);

  const setValue = useCallback((key: string, value: GenuiFieldValue) => {
    // Immutable update — never mutate the existing bag.
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const submit = useCallback(() => {
    if (!tabId) return;
    setStatus({ kind: 'submitting' });
    const payload: GenuiRecordPayload = { ...values };
    mutation.mutate(payload, {
      onSuccess: () => {
        setStatus({ kind: 'success' });
        // Reset to defaults so the form is ready for the next entry.
        setValues(initial);
      },
      onError: () => setStatus({ kind: 'error' }),
    });
  }, [tabId, values, initial, mutation]);

  return {
    values,
    setValue,
    status,
    submit,
    disabled: status.kind === 'submitting',
  };
}
