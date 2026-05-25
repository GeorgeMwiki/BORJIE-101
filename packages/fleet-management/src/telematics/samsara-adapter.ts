/**
 * Samsara telematics adapter (https://www.samsara.com/api).
 *
 *   - REST base: https://api.samsara.com
 *   - Auth: Bearer token (`apiKey` constructor arg)
 *   - Endpoints:
 *       GET /fleet/vehicles/stats?types=gps,engineStates,fuelPercents
 *       GET /fleet/vehicles/stats/feed?types=gps  (server-sent stream)
 *       GET /fleet/safety-events?vehicleIds=...
 *
 * This adapter implements the `TelematicsProvider` port. Network calls
 * are abstracted behind a `fetch`-shaped function so tests pin the wire
 * format without touching the real Samsara endpoint.
 *
 * Streaming uses a polling fallback if the SSE feed is not available
 * (mirrors what we do in production for Geotab).
 */

import {
  type TelematicsProvider,
  type TelematicsEvent,
  type TelematicsEventKind,
  type GeoPoint,
} from '../types.js';

export type FetchLike = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface SamsaraAdapterConfig {
  readonly apiKey: string;
  readonly tenantId: string;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly pollIntervalMs?: number;
}

interface SamsaraStatsRow {
  readonly id?: string;
  readonly gps?: { readonly latitude: number; readonly longitude: number; readonly headingDegrees?: number; readonly speedMilesPerHour?: number; readonly time?: string };
  readonly engineState?: { readonly value?: string };
  readonly fuelPercent?: { readonly value?: number };
  readonly faultCodes?: ReadonlyArray<{ readonly code: string }>;
}

interface SamsaraSafetyEvent {
  readonly id?: string;
  readonly vehicleId?: string;
  readonly time: string;
  readonly behaviorType?: string;
  readonly behaviorLabel?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly speedKilometersPerHour?: number;
}

function mphToKph(mph: number | undefined): number {
  return mph ? mph * 1.609344 : 0;
}

function mapSamsaraBehaviorToKind(label: string | undefined): TelematicsEventKind {
  if (!label) return 'fault_code';
  const l = label.toLowerCase();
  if (l.includes('harsh') && l.includes('brake')) return 'harsh_braking';
  if (l.includes('speed')) return 'speeding';
  if (l.includes('idle')) return 'idle';
  if (l.includes('crash') || l.includes('collision')) return 'collision';
  if (l.includes('geofence') && l.includes('exit')) return 'geofence_exit';
  if (l.includes('geofence')) return 'geofence_entry';
  if (l.includes('ignition off')) return 'ignition_off';
  if (l.includes('ignition')) return 'ignition_on';
  return 'fault_code';
}

export function createSamsaraAdapter(config: SamsaraAdapterConfig): TelematicsProvider {
  const baseUrl = (config.baseUrl ?? 'https://api.samsara.com').replace(/\/$/, '');
  const f: FetchLike = config.fetch
    ?? ((typeof fetch === 'function' ? fetch : undefined) as FetchLike | undefined)
    ?? (async () => { throw new Error('fetch unavailable; supply config.fetch'); });

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  };

  async function fetchStats(vehicleId: string): Promise<SamsaraStatsRow | null> {
    const url = `${baseUrl}/fleet/vehicles/stats?types=gps,engineStates,fuelPercents,faultCodes&vehicleIds=${encodeURIComponent(vehicleId)}`;
    const res = await f(url, { headers });
    if (!res.ok) return null;
    const body = (await res.json()) as { readonly data?: ReadonlyArray<SamsaraStatsRow> };
    return body.data?.[0] ?? null;
  }

  return {
    name: 'samsara',
    streamLocations(vehicleId, onLocation) {
      const interval = config.pollIntervalMs ?? 30_000;
      let stopped = false;
      const handle = setInterval(() => {
        if (stopped) return;
        fetchStats(vehicleId)
          .then((row) => {
            if (stopped || !row?.gps) return;
            const point: GeoPoint = {
              lat: row.gps.latitude,
              lng: row.gps.longitude,
              ...(row.gps.time ? { recordedAt: row.gps.time } : {}),
            };
            onLocation(point);
          })
          .catch(() => {
            /* swallow — caller polls again */
          });
      }, interval);
      return {
        stop(): void {
          stopped = true;
          clearInterval(handle);
        },
      };
    },
    async getCurrentState(vehicleId) {
      const row = await fetchStats(vehicleId);
      if (!row) return null;
      return {
        vehicleId,
        ...(row.gps
          ? {
              location: {
                lat: row.gps.latitude,
                lng: row.gps.longitude,
                ...(row.gps.time ? { recordedAt: row.gps.time } : {}),
              },
            }
          : {}),
        speedKph: mphToKph(row.gps?.speedMilesPerHour),
        headingDeg: row.gps?.headingDegrees ?? 0,
        ignitionOn: row.engineState?.value === 'On',
        ...(row.fuelPercent?.value !== undefined ? { fuelLevelPct: row.fuelPercent.value } : {}),
        faultCodes: row.faultCodes?.map((f2) => f2.code) ?? [],
        asOf: row.gps?.time ?? new Date().toISOString(),
      };
    },
    async getEvents(vehicleId, since) {
      const url = `${baseUrl}/fleet/safety-events?vehicleIds=${encodeURIComponent(vehicleId)}&startTime=${encodeURIComponent(since)}`;
      const res = await f(url, { headers });
      if (!res.ok) return [];
      const body = (await res.json()) as { readonly data?: ReadonlyArray<SamsaraSafetyEvent> };
      const rows = body.data ?? [];
      return rows.map<TelematicsEvent>((r) => ({
        id: r.id ?? `samsara_${r.time}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: config.tenantId,
        vehicleId: r.vehicleId ?? vehicleId,
        kind: mapSamsaraBehaviorToKind(r.behaviorLabel ?? r.behaviorType),
        occurredAt: r.time,
        ...(r.latitude !== undefined && r.longitude !== undefined
          ? { location: { lat: r.latitude, lng: r.longitude } }
          : {}),
        ...(r.speedKilometersPerHour !== undefined ? { speedKph: r.speedKilometersPerHour } : {}),
        metadata: {
          behaviorType: r.behaviorType ?? '',
          behaviorLabel: r.behaviorLabel ?? '',
        },
      }));
    },
  };
}
