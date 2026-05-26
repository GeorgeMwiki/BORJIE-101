/**
 * `emitFieldChange` — pure helper that owns the redact-then-emit
 * pipeline. Extracted from `useFieldCapture` so the contract can be
 * unit-tested without a React harness.
 *
 * The function returns a Promise that resolves once the event has
 * been enqueued. Callers (the hook) fire-and-forget; tests await.
 */

import { redact } from './pii-redactor.js';
import type { CaptureEvent } from '../types.js';

export interface EmitFieldChangeArgs {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly fieldId: string;
  readonly fieldType?: string | undefined;
  readonly value: string;
  readonly emit: (event: CaptureEvent) => void;
  /** Test seam — overrides the default sha256 hasher. */
  readonly hasher?: (input: string) => Promise<string>;
}

export async function emitFieldChange(args: EmitFieldChangeArgs): Promise<void> {
  const fieldValue = await redact({
    tenantId: args.tenantId,
    tabId: args.tabId,
    fieldId: args.fieldId,
    ...(args.fieldType !== undefined ? { fieldType: args.fieldType } : {}),
    value: args.value,
    ...(args.hasher !== undefined ? { hasher: args.hasher } : {}),
  });
  args.emit({
    kind: 'field_change',
    emittedAt: new Date().toISOString(),
    sessionId: args.sessionId,
    tabId: args.tabId,
    fieldId: args.fieldId,
    value: fieldValue,
  });
}
