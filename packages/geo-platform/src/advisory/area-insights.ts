/**
 * Area Insights — one call that combines Solar + Air Quality + Pollen
 * + (zero or more) drive-time samples into a single bundle suitable
 * for rendering on the parcel-detail page.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §1, §2, §11.
 *
 * Concurrency: all four upstream calls run in parallel via
 * `Promise.all`. Per-section failures are captured in `errors` and
 * the bundle is still returned — partial data > nothing.
 */

import type {
  AreaInsights,
  ClientCallOptions,
  DriveTimeSample,
  ErrorResult,
  GeoResult,
  RouteWaypoint,
} from '../types.js';
import { asError } from '../google/http.js';
import { fetchBuildingInsights } from '../google/solar-api-client.js';
import { fetchCurrentConditions } from '../google/air-quality-client.js';
import { fetchPollenForecast } from '../google/pollen-api-client.js';
import { computeRoute } from '../google/routes-api-client.js';

export interface AreaInsightsInput {
  readonly lat: number;
  readonly lng: number;
  /** Each entry yields one `DriveTimeSample`. */
  readonly driveTimeTargets?: ReadonlyArray<{
    readonly label: string;
    readonly destination: RouteWaypoint;
  }>;
  /** Disable any of the four sub-fetches. Default = all enabled. */
  readonly include?: {
    readonly solar?: boolean;
    readonly airQuality?: boolean;
    readonly pollen?: boolean;
    readonly routes?: boolean;
  };
}

function pickErr<T>(r: GeoResult<T>): ErrorResult['error'] | undefined {
  return r.ok ? undefined : asError(r).error;
}

export async function fetchAreaInsights(
  input: AreaInsightsInput,
  options: ClientCallOptions = {},
): Promise<AreaInsights> {
  const include = {
    solar: input.include?.solar ?? true,
    airQuality: input.include?.airQuality ?? true,
    pollen: input.include?.pollen ?? true,
    routes: input.include?.routes ?? true,
  };

  const solarP = include.solar
    ? fetchBuildingInsights({ lat: input.lat, lng: input.lng }, options)
    : Promise.resolve<GeoResult<never>>({
        ok: false,
        error: { kind: 'unsupported_region', message: 'Disabled by caller.' },
      });
  const airP = include.airQuality
    ? fetchCurrentConditions({ lat: input.lat, lng: input.lng }, options)
    : Promise.resolve<GeoResult<never>>({
        ok: false,
        error: { kind: 'unsupported_region', message: 'Disabled by caller.' },
      });
  const pollenP = include.pollen
    ? fetchPollenForecast({ lat: input.lat, lng: input.lng }, options)
    : Promise.resolve<GeoResult<never>>({
        ok: false,
        error: { kind: 'unsupported_region', message: 'Disabled by caller.' },
      });

  const targets = include.routes ? input.driveTimeTargets ?? [] : [];
  const routesP = Promise.all(
    targets.map(async (target) => {
      const r = await computeRoute(
        {
          origin: { lat: input.lat, lng: input.lng },
          destination: target.destination,
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        },
        options,
      );
      return { target, r };
    }),
  );

  const [solarR, airR, pollenR, routeRows] = await Promise.all([
    solarP,
    airP,
    pollenP,
    routesP,
  ]);

  const driveTimes: DriveTimeSample[] = [];
  let routesErr: ErrorResult['error'] | undefined;
  for (const row of routeRows) {
    if (!row.r.ok) {
      // Keep the first error we see; surface partial data for the rest.
      if (!routesErr) routesErr = asError(row.r).error;
      continue;
    }
    driveTimes.push({
      destinationLabel: row.target.label,
      destination: row.target.destination,
      durationSeconds: row.r.data.durationSeconds,
      distanceMeters: row.r.data.distanceMeters,
    });
  }

  return {
    center: { lat: input.lat, lng: input.lng },
    fetchedAt: new Date().toISOString(),
    solar: solarR.ok ? solarR.data : undefined,
    airQuality: airR.ok ? airR.data : undefined,
    pollen: pollenR.ok ? pollenR.data : undefined,
    driveTimes,
    errors: {
      solar: pickErr(solarR),
      airQuality: pickErr(airR),
      pollen: pickErr(pollenR),
      routes: routesErr,
    },
  };
}
