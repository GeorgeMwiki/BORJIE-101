/**
 * Superpower 2 — prefill.
 *
 * Forms register a `formId` and a setter; the bus publishes
 * `{ formId, values }` payloads from anywhere (chat surface, sensor
 * suggestion, deep link). Mirrors the web bus shape so the same
 * upstream emitter can target both surfaces.
 */
import { useEffect } from 'react'
import { formPrefillBus, type FormPrefillEvent } from './bus'

export type PrefillApplier = (values: Readonly<Record<string, unknown>>, submit: boolean) => void

export function publishPrefill(event: FormPrefillEvent): void {
  formPrefillBus.publish(event)
}

/**
 * Subscribe a form to prefill events. Pass the formId so other forms
 * on the same screen ignore the payload.
 */
export function useSuperpowerPrefill(formId: string, apply: PrefillApplier): void {
  useEffect(() => {
    const unsubscribe = formPrefillBus.subscribe((event) => {
      if (event.formId !== formId) return
      apply(event.values, event.submitOnAccept ?? false)
    })
    return unsubscribe
  }, [formId, apply])
}
