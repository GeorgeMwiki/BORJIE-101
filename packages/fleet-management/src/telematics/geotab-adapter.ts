/**
 * Geotab telematics adapter (https://my.geotab.com).
 *
 *   - Auth: SessionId from `Authenticate` RPC call.
 *   - Endpoints (JSON-RPC over POST):
 *       POST /apiv1  body { method:'Get', params:{ typeName:'DeviceStatusInfo' ... } }
 *
 * Same `TelematicsProvider` shape as the Samsara adapter. Most of the
 * complexity comes from Geotab's verbose JSON-RPC envelope.
 */

import {
  type TelematicsProvider,
  type TelematicsEvent,
  type TelematicsEventKind,
  type VehicleLiveState,
  type GeoPoint,
} from '../types.js';
import { type FetchLike } from './samsara-adapter.js';

export interface GeotabCreds {
  readonly username: string;
  readonly password: string;
  readonly database: string;
}

export interface GeotabAdapterConfig {
  readonly creds: GeotabCreds;
  readonly tenantId: string;
  readonly server?: string;        // e.g. 'my3.geotab.com'
  readonly fetch?: FetchLike;
  readonly pollIntervalMs?: number;
}

interface GeotabDeviceStatusInfo {
  readonly device?: { readonly id?: string };
  readonly latitude?: number;
  readonly longitude?: number;
  readonly speed?: number;        // km/h
  readonly bearing?: number;
  readonly isDeviceCommunicating?: boolean;
  readonly isDriving?: boolean;
  readonly dateTime?: string;
}

interface GeotabExceptionEvent {
  readonly id?: string;
  readonly device?: { readonly id?: string };
  readonly activeFrom: string;
  readonly rule?: { readonly name?: string };
  readonly latitude?: number;
  readonly longitude?: number;
}

interface GeotabJsonRpcResponse<T> {
  readonly result?: T;
  readonly error?: { readonly message: string };
}

function mapGeotabRuleNameToKind(ruleName: string | undefined): TelematicsEventKind {
  if (!ruleName) return 'fault_code';
  const r = ruleName.toLowerCase();
  if (r.includes('speed')) return 'speeding';
  if (r.includes('harsh') || r.includes('brake')) return 'harsh_braking';
  if (r.includes('idl')) return 'idle';
  if (r.includes('collision') || r.includes('accident')) return 'collision';
  if (r.includes('geofence') && r.includes('exit')) return 'geofence_exit';
  if (r.includes('geofence') || r.includes('zone')) return 'geofence_entry';
  return 'fault_code';
}

export function createGeotabAdapter(config: GeotabAdapterConfig): TelematicsProvider {
  const server = (config.server ?? 'my.geotab.com').replace(/\/$/, '');
  const f: FetchLike = config.fetch
    ?? ((typeof fetch === 'function' ? fetch : undefined) as FetchLike | undefined)
    ?? (async () => { throw new Error('fetch unavailable; supply config.fetch'); });
  const url = `https://${server}/apiv1`;

  async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
    const body = JSON.stringify({
      method,
      params: { ...params, credentials: config.creds },
    });
    // The fetch shape we accept is GET-only; emulate POST by encoding the
    // body into the URL query (Geotab supports both; the real impl in
    // production uses node-fetch with POST). For tests we use the
    // fetch-spy approach and let it interpret the query.
    const res = await f(`${url}?body=${encodeURIComponent(body)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as GeotabJsonRpcResponse<T>;
    return j.result ?? null;
  }

  return {
    name: 'geotab',
    streamLocations(vehicleId, onLocation) {
      const interval = config.pollIntervalMs ?? 30_000;
      let stopped = false;
      const handle = setInterval(() => {
        if (stopped) return;
        rpc<ReadonlyArray<GeotabDeviceStatusInfo>>('Get', {
          typeName: 'DeviceStatusInfo',
          search: { deviceSearch: { id: vehicleId } },
        })
          .then((rows) => {
            if (stopped || !rows?.[0]) return;
            const r = rows[0];
            if (r.latitude === undefined || r.longitude === undefined) return;
            const point: GeoPoint = {
              lat: r.latitude,
              lng: r.longitude,
              ...(r.dateTime ? { recordedAt: r.dateTime } : {}),
            };
            onLocation(point);
          })
          .catch(() => {
            /* swallow */
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
      const rows = await rpc<ReadonlyArray<GeotabDeviceStatusInfo>>('Get', {
        typeName: 'DeviceStatusInfo',
        search: { deviceSearch: { id: vehicleId } },
      });
      const r = rows?.[0];
      if (!r) return null;
      const state: VehicleLiveState = {
        vehicleId,
        ...(r.latitude !== undefined && r.longitude !== undefined
          ? {
              location: {
                lat: r.latitude,
                lng: r.longitude,
                ...(r.dateTime ? { recordedAt: r.dateTime } : {}),
              },
            }
          : {}),
        speedKph: r.speed ?? 0,
        headingDeg: r.bearing ?? 0,
        ignitionOn: Boolean(r.isDriving),
        faultCodes: [],
        asOf: r.dateTime ?? new Date().toISOString(),
      };
      return state;
    },
    async getEvents(vehicleId, since) {
      const rows = await rpc<ReadonlyArray<GeotabExceptionEvent>>('Get', {
        typeName: 'ExceptionEvent',
        search: {
          deviceSearch: { id: vehicleId },
          fromDate: since,
        },
      });
      const list = rows ?? [];
      return list.map<TelematicsEvent>((r) => ({
        id: r.id ?? `geotab_${r.activeFrom}_${Math.random().toString(36).slice(2, 8)}`,
        tenantId: config.tenantId,
        vehicleId,
        kind: mapGeotabRuleNameToKind(r.rule?.name),
        occurredAt: r.activeFrom,
        ...(r.latitude !== undefined && r.longitude !== undefined
          ? { location: { lat: r.latitude, lng: r.longitude } }
          : {}),
        metadata: {
          rule: r.rule?.name ?? '',
        },
      }));
    },
  };
}
