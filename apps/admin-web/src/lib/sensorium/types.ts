/**
 * Sensorium shared types — Central Command Phase A (C4 Brain Skin).
 *
 * The 14-event taxonomy lives in `.planning/central-command/00-architecture.md`.
 * These types are the contract between every event handler, the
 * `SensoriumProvider`, the `event-bus-client`, and the api-gateway
 * POST /api/v1/sensorium/events surface.
 *
 * All types are deeply readonly. Handlers MUST NOT mutate the
 * objects they emit — the bus deep-clones before send anyway, but
 * the convention is enforced at the type layer to keep audit chains
 * tamper-evident.
 */

export const SENSORIUM_EVENT_TYPES = [
  'page.view',
  'page.leave',
  'element.click',
  'input.change',
  'form.submit',
  'scroll.depth',
  'dwell.time',
  'focus.change',
  'keyboard.shortcut',
  'copy.paste',
  'viewport.resize',
  'network.request',
  'error.boundary',
  'a11y.tree.diff',
] as const;

export type SensoryEventType = (typeof SENSORIUM_EVENT_TYPES)[number];

export interface SensoryEvent {
  readonly eventType: SensoryEventType;
  readonly route: string;
  readonly emittedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SensoriumBusOptions {
  /** Stable session id — survives route changes within one tab. */
  readonly sessionId: string;
  /** Surface name — e.g. `admin-web`. */
  readonly surface: string;
  /** Override the default POST target. */
  readonly endpoint?: string;
  /** Override the default flush interval (ms). */
  readonly flushIntervalMs?: number;
  /** Override the max batch size (also enforced server-side). */
  readonly maxBatchSize?: number;
  /** Test seam — inject a custom `fetch` for jsdom/unit tests. */
  readonly fetchImpl?: typeof fetch;
}
