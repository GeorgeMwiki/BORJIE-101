/**
 * Conversion tracker — pure event-shape builder.
 *
 * The marketing-studio package does not own persistence; callers
 * persist the events into `marketing_telemetry_events`. The tracker
 * exposes a single pure function `buildTelemetryEvent` for shape
 * stability across the codebase.
 */

import type { AudienceSegment, Channel } from '../types.js';

export type EventKind =
  | 'impression'
  | 'click'
  | 'engagement'
  | 'conversion'
  | 'share'
  | 'comment';

export interface TelemetryEvent {
  readonly asset_id: string;
  readonly tenant_id: string;
  readonly event_kind: EventKind;
  readonly channel: Channel;
  readonly visitor_segment?: AudienceSegment;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recorded_at: string;
}

export interface BuildEventArgs {
  readonly asset_id: string;
  readonly tenant_id: string;
  readonly event_kind: EventKind;
  readonly channel: Channel;
  readonly visitor_segment?: AudienceSegment;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly recorded_at?: string;
}

export function buildTelemetryEvent(args: BuildEventArgs): TelemetryEvent {
  const base = {
    asset_id: args.asset_id,
    tenant_id: args.tenant_id,
    event_kind: args.event_kind,
    channel: args.channel,
    payload: args.payload ?? {},
    recorded_at: args.recorded_at ?? new Date().toISOString(),
  };
  if (args.visitor_segment !== undefined) {
    return Object.freeze({
      ...base,
      visitor_segment: args.visitor_segment,
    });
  }
  return Object.freeze(base);
}
