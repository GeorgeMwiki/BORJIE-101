/**
 * Attribution — last-touch with 7-day window (configurable).
 *
 * Walks an event stream sorted by recorded_at and attributes each
 * conversion to the most-recent prior click within the window.
 * Returns a mapping conversion_event_id → click_event_id (or null
 * when no click resolves).
 */

import type { TelemetryEvent } from './conversion-tracker.js';

export interface AttributionArgs {
  readonly events: ReadonlyArray<TelemetryEvent>;
  readonly window_days?: number;
}

const DEFAULT_WINDOW_DAYS = 7;

export interface AttributionResult {
  /** asset_id → number of conversions attributed to that asset. */
  readonly attributed_conversions: Readonly<Record<string, number>>;
  /** Total conversions seen (denominator). */
  readonly total_conversions: number;
}

export function attributeLastTouch(args: AttributionArgs): AttributionResult {
  const windowMs = (args.window_days ?? DEFAULT_WINDOW_DAYS) * 24 * 3600 * 1000;
  const sorted = [...args.events].sort((a, b) =>
    a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0,
  );
  // visitor_id → { asset_id, click_at_ms }
  const lastClick: Map<string, { readonly asset_id: string; readonly at_ms: number }> = new Map();
  const attributed: Record<string, number> = {};
  let totalConv = 0;

  for (const e of sorted) {
    const visitorId = readVisitorId(e);
    if (visitorId === null) {
      continue;
    }
    const atMs = Date.parse(e.recorded_at);
    if (Number.isNaN(atMs)) {
      continue;
    }
    if (e.event_kind === 'click') {
      lastClick.set(visitorId, { asset_id: e.asset_id, at_ms: atMs });
      continue;
    }
    if (e.event_kind === 'conversion') {
      totalConv += 1;
      const prev = lastClick.get(visitorId);
      if (prev !== undefined && atMs - prev.at_ms <= windowMs) {
        attributed[prev.asset_id] = (attributed[prev.asset_id] ?? 0) + 1;
      }
    }
  }
  return {
    attributed_conversions: Object.freeze(attributed),
    total_conversions: totalConv,
  };
}

function readVisitorId(e: TelemetryEvent): string | null {
  const raw = e.payload['visitor_id'];
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  return null;
}
