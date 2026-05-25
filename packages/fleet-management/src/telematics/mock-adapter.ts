/**
 * Mock telematics adapter — deterministic, dependency-free, used for
 * tests + local dev. Stores per-vehicle state in memory and emits
 * pre-seeded events back to `getEvents`.
 *
 * The streaming surface invokes the callback on a setTimeout schedule
 * the consumer can stop via the returned handle.
 */

import {
  type TelematicsProvider,
  type VehicleLiveState,
  type TelematicsEvent,
  type GeoPoint,
  type TelematicsEventKind,
} from '../types.js';

export interface MockTelematicsSeed {
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly initialState?: Omit<VehicleLiveState, 'vehicleId'>;
  readonly events?: ReadonlyArray<Omit<TelematicsEvent, 'id' | 'tenantId' | 'vehicleId'>>;
  readonly breadcrumbs?: ReadonlyArray<GeoPoint>;
}

export interface MockTelematicsOptions {
  readonly streamIntervalMs?: number;
}

let _evtCounter = 0;
function nextEventId(): string {
  _evtCounter += 1;
  return `te_${Date.now().toString(36)}_${_evtCounter}`;
}

const NOOP_STATE: VehicleLiveState = {
  vehicleId: '',
  speedKph: 0,
  headingDeg: 0,
  ignitionOn: false,
  faultCodes: [],
  asOf: new Date(0).toISOString(),
};

export function createMockTelematics(
  seeds: ReadonlyArray<MockTelematicsSeed> = [],
  options: MockTelematicsOptions = {},
): TelematicsProvider & {
  readonly seed: (s: MockTelematicsSeed) => void;
  readonly publishEvent: (vehicleId: string, e: Omit<TelematicsEvent, 'id' | 'tenantId' | 'vehicleId'> & { readonly tenantId?: string }) => void;
} {
  const stateByVehicle = new Map<string, VehicleLiveState>();
  const eventsByVehicle = new Map<string, TelematicsEvent[]>();
  const breadcrumbsByVehicle = new Map<string, GeoPoint[]>();

  const apply = (s: MockTelematicsSeed): void => {
    if (s.initialState) {
      stateByVehicle.set(s.vehicleId, { ...s.initialState, vehicleId: s.vehicleId });
    } else if (!stateByVehicle.has(s.vehicleId)) {
      stateByVehicle.set(s.vehicleId, { ...NOOP_STATE, vehicleId: s.vehicleId });
    }
    const existing = eventsByVehicle.get(s.vehicleId) ?? [];
    const events: TelematicsEvent[] = (s.events ?? []).map((e) => ({
      ...e,
      id: nextEventId(),
      tenantId: s.tenantId,
      vehicleId: s.vehicleId,
    }));
    eventsByVehicle.set(s.vehicleId, [...existing, ...events]);
    if (s.breadcrumbs?.length) {
      breadcrumbsByVehicle.set(s.vehicleId, [...s.breadcrumbs]);
    }
  };

  for (const s of seeds) apply(s);

  return {
    name: 'mock',
    streamLocations(vehicleId, onLocation) {
      const crumbs = breadcrumbsByVehicle.get(vehicleId) ?? [];
      let i = 0;
      const intervalMs = options.streamIntervalMs ?? 0; // 0 = immediate burst (tests)
      let handle: ReturnType<typeof setInterval> | null = null;
      let stopped = false;
      if (intervalMs <= 0) {
        for (const p of crumbs) onLocation(p);
      } else {
        handle = setInterval(() => {
          if (stopped) return;
          const next = crumbs[i++];
          if (!next) {
            if (handle) clearInterval(handle);
            return;
          }
          onLocation(next);
        }, intervalMs);
      }
      return {
        stop(): void {
          stopped = true;
          if (handle) clearInterval(handle);
        },
      };
    },
    async getCurrentState(vehicleId) {
      const s = stateByVehicle.get(vehicleId);
      return s ?? null;
    },
    async getEvents(vehicleId, since) {
      const list = eventsByVehicle.get(vehicleId) ?? [];
      return list.filter((e) => e.occurredAt >= since);
    },
    seed: apply,
    publishEvent(vehicleId, e) {
      const existing = eventsByVehicle.get(vehicleId) ?? [];
      const event: TelematicsEvent = {
        ...e,
        id: nextEventId(),
        tenantId: e.tenantId ?? existing[0]?.tenantId ?? '',
        vehicleId,
      } as TelematicsEvent;
      eventsByVehicle.set(vehicleId, [...existing, event]);
    },
  };
}

export const KNOWN_EVENT_KINDS: ReadonlyArray<TelematicsEventKind> = [
  'ignition_on',
  'ignition_off',
  'speeding',
  'harsh_braking',
  'idle',
  'geofence_entry',
  'geofence_exit',
  'collision',
  'fault_code',
];
