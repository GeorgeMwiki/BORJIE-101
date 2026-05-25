/**
 * Telematics — mock adapter, Samsara + Geotab stubs (fetch spied).
 */
import { describe, it, expect } from 'vitest';
import { createMockTelematics } from '../telematics/mock-adapter.js';
import { createSamsaraAdapter } from '../telematics/samsara-adapter.js';
import { createGeotabAdapter } from '../telematics/geotab-adapter.js';
import { type GeoPoint } from '../types.js';

const TENANT = 'tnt-1';

describe('telematics / mock adapter', () => {
  it('returns seeded live state', async () => {
    const mock = createMockTelematics([
      {
        tenantId: TENANT,
        vehicleId: 'veh-1',
        initialState: {
          location: { lat: -6.79, lng: 39.20 },
          speedKph: 40,
          headingDeg: 180,
          ignitionOn: true,
          faultCodes: [],
          asOf: '2026-05-24T08:00:00Z',
        },
      },
    ]);
    const state = await mock.getCurrentState('veh-1');
    expect(state?.speedKph).toBe(40);
    expect(state?.location?.lat).toBeCloseTo(-6.79, 2);
  });

  it('returns null for unknown vehicle', async () => {
    const mock = createMockTelematics();
    expect(await mock.getCurrentState('nope')).toBeNull();
  });

  it('streams seeded breadcrumbs synchronously when intervalMs=0', async () => {
    const points: GeoPoint[] = [];
    const mock = createMockTelematics(
      [{ tenantId: TENANT, vehicleId: 'veh-1', breadcrumbs: [
        { lat: 0, lng: 0 }, { lat: 1, lng: 1 },
      ] }],
    );
    const handle = mock.streamLocations('veh-1', (p) => points.push(p));
    handle.stop();
    expect(points).toHaveLength(2);
  });

  it('publishEvent + getEvents round-trip respects since cursor', async () => {
    const mock = createMockTelematics([
      { tenantId: TENANT, vehicleId: 'veh-1', events: [
        { kind: 'speeding', occurredAt: '2026-05-24T07:00:00Z', metadata: {} },
        { kind: 'harsh_braking', occurredAt: '2026-05-24T09:00:00Z', metadata: {} },
      ] },
    ]);
    const events = await mock.getEvents('veh-1', '2026-05-24T08:00:00Z');
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('harsh_braking');
  });
});

describe('telematics / samsara adapter', () => {
  it('decodes stats response into VehicleLiveState', async () => {
    const fetchSpy = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            {
              id: 'veh-1',
              gps: {
                latitude: -6.79,
                longitude: 39.20,
                speedMilesPerHour: 30,
                headingDegrees: 270,
                time: '2026-05-24T08:00:00Z',
              },
              engineState: { value: 'On' },
              fuelPercent: { value: 65 },
              faultCodes: [{ code: 'P0420' }],
            },
          ],
        };
      },
    });
    const samsara = createSamsaraAdapter({ apiKey: 'k', tenantId: TENANT, fetch: fetchSpy });
    const state = await samsara.getCurrentState('veh-1');
    expect(state?.speedKph).toBeCloseTo(30 * 1.609344, 1);
    expect(state?.ignitionOn).toBe(true);
    expect(state?.fuelLevelPct).toBe(65);
    expect(state?.faultCodes).toEqual(['P0420']);
  });

  it('maps safety events to our kind taxonomy', async () => {
    const fetchSpy = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          data: [{ id: 'e1', vehicleId: 'veh-1', time: '2026-05-24T08:00:00Z', behaviorLabel: 'Harsh Brake' }],
        };
      },
    });
    const samsara = createSamsaraAdapter({ apiKey: 'k', tenantId: TENANT, fetch: fetchSpy });
    const events = await samsara.getEvents('veh-1', '2026-01-01T00:00:00Z');
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('harsh_braking');
  });
});

describe('telematics / geotab adapter', () => {
  it('decodes DeviceStatusInfo into VehicleLiveState', async () => {
    const fetchSpy = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          result: [
            {
              device: { id: 'veh-1' },
              latitude: -6.79,
              longitude: 39.20,
              speed: 55,
              bearing: 180,
              isDriving: true,
              dateTime: '2026-05-24T08:00:00Z',
            },
          ],
        };
      },
    });
    const geotab = createGeotabAdapter({
      creds: { username: 'u', password: 'p', database: 'd' },
      tenantId: TENANT,
      fetch: fetchSpy,
    });
    const state = await geotab.getCurrentState('veh-1');
    expect(state?.speedKph).toBe(55);
    expect(state?.ignitionOn).toBe(true);
  });
});
