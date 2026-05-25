/**
 * Shared handler contract — Central Command Phase A (C4 Brain Skin).
 *
 * Every event handler exposes the same hook-up shape so the
 * `SensoriumProvider` can wire them uniformly:
 *
 *   - `install(emit, ctx)` attaches the necessary DOM listeners and
 *     returns a teardown function.
 *
 * The `emit` callback is the only way a handler should push events.
 * Handlers MUST be PII-aware — they call into `pii-redactor` before
 * emitting any field-derived payload.
 */

import type { SensoryEvent } from '../types.js';

export type EmitFn = (event: SensoryEvent) => void;

export interface HandlerContext {
  readonly route: () => string;
  readonly surface: string;
}

export type HandlerInstall = (
  emit: EmitFn,
  ctx: HandlerContext,
) => () => void;

export interface SensoryHandler {
  readonly id: string;
  readonly install: HandlerInstall;
}
