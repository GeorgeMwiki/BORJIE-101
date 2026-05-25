'use client';

/**
 * GeoAdvisorClient — Leaflet map + parcel painter + area-insights
 * side panel.
 *
 * Leaflet is loaded only on the client (Next does not ship `window`
 * during SSR). The map fetches:
 *
 *   - `GET /api/v1/advisor/geo/parcels?bbox=...` for the painted parcel
 *     polygons in the current viewport
 *   - `GET /api/v1/advisor/geo/area-insights?lat=..&lng=..` whenever
 *     the operator clicks a parcel, which returns the AreaInsights
 *     bundle (solar, air quality, drive-time samples)
 *
 * If `react-leaflet` is unavailable at runtime (very old browsers,
 * SSR rehydration edge cases) we render a degraded list-only view.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { AdvisorEmpty, AdvisorError, AdvisorLoading } from '../_lib/states';

const positionSchema = z.tuple([z.number(), z.number()]);

const paintedParcelSchema = z.object({
  id: z.string(),
  label: z.string(),
  polygon: z.array(positionSchema),
  color: z.string().optional(),
  center: z.object({ lat: z.number(), lng: z.number() }),
});

const parcelsResponseSchema = z.object({
  parcels: z.array(paintedParcelSchema),
});

const areaInsightsResponseSchema = z.object({
  center: z.object({ lat: z.number(), lng: z.number() }),
  solar: z
    .object({
      maxArrayPanelsCount: z.number(),
      maxArrayAreaSqm: z.number(),
      maxSunshineHoursPerYear: z.number(),
      carbonOffsetFactorKgPerMwh: z.number(),
    })
    .nullable()
    .optional(),
  airQuality: z
    .object({
      indexes: z.array(
        z.object({
          code: z.string(),
          displayName: z.string(),
          aqi: z.number(),
          category: z.string(),
        }),
      ),
      pollutants: z.array(
        z.object({
          code: z.string(),
          displayName: z.string(),
          concentration: z.object({
            value: z.number(),
            units: z.string(),
          }),
        }),
      ),
    })
    .nullable()
    .optional(),
  driveTimes: z.array(
    z.object({
      destinationLabel: z.string(),
      durationSeconds: z.number(),
      distanceMeters: z.number(),
    }),
  ),
});

type PaintedParcel = z.infer<typeof paintedParcelSchema>;
type AreaInsights = z.infer<typeof areaInsightsResponseSchema>;

interface ParcelsState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly parcels: ReadonlyArray<PaintedParcel>;
  readonly error?: string;
}

interface InsightsState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly data?: AreaInsights;
  readonly error?: string;
}

const DEFAULT_CENTER: [number, number] = [-1.2667, 36.8167]; // Nairobi
const DEFAULT_ZOOM = 13;

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost'
  ) {
    return 'http://localhost:4000/api/v1';
  }
  return '/api/v1';
}

// Leaflet must be loaded client-only — Next.js does not ship `window`
// during SSR and react-leaflet imports it eagerly. The static-string
// import is rewritten by Next's bundler so the on-disk extension is
// not required for the runtime resolver, but the typechecker (under
// nodenext) needs an explicit `.js` (which resolves to `.tsx`).
const ParcelMap = dynamic(
  () =>
    import('./ParcelMap.js').then((m) => ({ default: m.ParcelMap })),
  { ssr: false, loading: () => <AdvisorLoading label="Loading map…" /> },
) as unknown as (props: {
  readonly center: [number, number];
  readonly zoom: number;
  readonly parcels: ReadonlyArray<PaintedParcel>;
  readonly selectedParcelId: string | null;
  readonly onParcelClick: (p: PaintedParcel) => void;
}) => JSX.Element;

export function GeoAdvisorClient(): JSX.Element {
  const [parcels, setParcels] = useState<ParcelsState>({
    status: 'idle',
    parcels: [],
  });
  const [insights, setInsights] = useState<InsightsState>({ status: 'idle' });
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);

  const fetchParcels = useCallback(async () => {
    setParcels((prev) => ({ ...prev, status: 'loading' }));
    try {
      const res = await fetch(`${getApiBase()}/advisor/geo/parcels`, {
        credentials: 'include',
      });
      const json: { data?: unknown; error?: { message?: string } } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setParcels({
          status: 'error',
          parcels: [],
          error:
            json.error?.message ?? `Upstream returned HTTP ${res.status}`,
        });
        return;
      }
      const parsed = parcelsResponseSchema.safeParse(json.data ?? json);
      if (!parsed.success) {
        setParcels({
          status: 'error',
          parcels: [],
          error: 'Parcel response did not match contract.',
        });
        return;
      }
      setParcels({ status: 'ok', parcels: parsed.data.parcels });
    } catch (error) {
      console.error('geo parcels fetch failed:', error);
      setParcels({
        status: 'error',
        parcels: [],
        error: 'Network error reaching api-gateway',
      });
    }
  }, []);

  const fetchInsights = useCallback(
    async (lat: number, lng: number) => {
      setInsights({ status: 'loading' });
      try {
        // This component is 'use client' so `window` is always defined.
        // The SSR-time branch only exists to satisfy the URL constructor
        // type — it is unreachable at runtime. We pick a sentinel that
        // makes the unreachable path loud if it ever flips (no silent
        // routing to localhost from a server-rendered prod bundle).
        const baseOrigin =
          typeof window === 'undefined'
            ? 'http://ssr-unreachable.invalid'
            : window.location.origin;
        const url = new URL(
          `${getApiBase()}/advisor/geo/area-insights`,
          baseOrigin,
        );
        url.searchParams.set('lat', lat.toString());
        url.searchParams.set('lng', lng.toString());
        const res = await fetch(url.toString(), { credentials: 'include' });
        const json: { data?: unknown; error?: { message?: string } } = await res
          .json()
          .catch(() => ({}));
        if (!res.ok) {
          setInsights({
            status: 'error',
            error:
              json.error?.message ?? `Upstream returned HTTP ${res.status}`,
          });
          return;
        }
        const parsed = areaInsightsResponseSchema.safeParse(json.data ?? json);
        if (!parsed.success) {
          setInsights({
            status: 'error',
            error: 'Insights response did not match contract.',
          });
          return;
        }
        setInsights({ status: 'ok', data: parsed.data });
      } catch (error) {
        console.error('geo area-insights fetch failed:', error);
        setInsights({
          status: 'error',
          error: 'Network error reaching api-gateway',
        });
      }
    },
    [],
  );

  useEffect(() => {
    void fetchParcels();
  }, [fetchParcels]);

  const handleParcelClick = useCallback(
    (parcel: PaintedParcel) => {
      setSelectedParcelId(parcel.id);
      void fetchInsights(parcel.center.lat, parcel.center.lng);
    },
    [fetchInsights],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section
        className="lg:col-span-2 platform-card"
        aria-label="Parcel map"
        style={{ minHeight: '480px' }}
      >
        {parcels.status === 'loading' && parcels.parcels.length === 0 ? (
          <AdvisorLoading label="Loading parcels…" />
        ) : parcels.status === 'error' && parcels.parcels.length === 0 ? (
          <AdvisorError message={parcels.error ?? 'Parcels unavailable'} />
        ) : (
          <ParcelMap
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            parcels={parcels.parcels}
            selectedParcelId={selectedParcelId}
            onParcelClick={handleParcelClick}
          />
        )}
      </section>

      <aside
        className="lg:col-span-1 space-y-4"
        aria-label="Area insights"
      >
        {selectedParcelId === null ? (
          <AdvisorEmpty
            title="No parcel selected"
            hint="Click a painted parcel to pull solar potential, air quality, and drive-time samples."
          />
        ) : insights.status === 'loading' ? (
          <AdvisorLoading label="Pulling area insights…" />
        ) : insights.status === 'error' ? (
          <AdvisorError message={insights.error ?? 'Insights unavailable'} />
        ) : insights.status === 'ok' && insights.data ? (
          <AreaInsightsPanel insights={insights.data} />
        ) : null}
      </aside>
    </div>
  );
}

function AreaInsightsPanel({
  insights,
}: {
  readonly insights: AreaInsights;
}): JSX.Element {
  return (
    <>
      {insights.solar ? (
        <article className="platform-card">
          <h3 className="text-sm font-medium text-neutral-300 mb-3">Solar</h3>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-neutral-500">Max panels</dt>
            <dd className="text-right text-neutral-200">
              {insights.solar.maxArrayPanelsCount.toLocaleString()}
            </dd>
            <dt className="text-neutral-500">Array area</dt>
            <dd className="text-right text-neutral-200">
              {insights.solar.maxArrayAreaSqm.toFixed(0)} m²
            </dd>
            <dt className="text-neutral-500">Sunshine / yr</dt>
            <dd className="text-right text-neutral-200">
              {Math.round(insights.solar.maxSunshineHoursPerYear).toLocaleString()} h
            </dd>
            <dt className="text-neutral-500">Carbon offset</dt>
            <dd className="text-right text-neutral-200">
              {insights.solar.carbonOffsetFactorKgPerMwh.toFixed(0)} kgCO₂/MWh
            </dd>
          </dl>
        </article>
      ) : null}

      {insights.airQuality ? (
        <article className="platform-card">
          <h3 className="text-sm font-medium text-neutral-300 mb-3">
            Air quality
          </h3>
          {insights.airQuality.indexes.length === 0 ? (
            <p className="text-xs text-neutral-500">No index reported.</p>
          ) : (
            <ul className="space-y-2">
              {insights.airQuality.indexes.map((ix) => (
                <li
                  key={ix.code}
                  className="flex items-baseline justify-between text-xs"
                >
                  <div>
                    <div className="text-neutral-200">{ix.displayName}</div>
                    <div className="text-neutral-500">{ix.category}</div>
                  </div>
                  <div className="text-lg font-display text-foreground">
                    {ix.aqi}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {insights.airQuality.pollutants.length > 0 ? (
            <div className="mt-3 pt-3 border-t border-border text-xs">
              <div className="text-neutral-500 mb-1">Pollutants</div>
              <ul className="space-y-0.5">
                {insights.airQuality.pollutants.slice(0, 4).map((p) => (
                  <li
                    key={p.code}
                    className="flex justify-between text-neutral-300"
                  >
                    <span>{p.displayName}</span>
                    <span>
                      {p.concentration.value.toFixed(1)} {p.concentration.units}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ) : null}

      {insights.driveTimes.length > 0 ? (
        <article className="platform-card">
          <h3 className="text-sm font-medium text-neutral-300 mb-3">
            Drive-time samples
          </h3>
          <ul className="space-y-1 text-xs">
            {insights.driveTimes.map((dt) => (
              <li
                key={dt.destinationLabel}
                className="flex items-baseline justify-between"
              >
                <span className="text-neutral-300">{dt.destinationLabel}</span>
                <span className="text-neutral-400">
                  {Math.round(dt.durationSeconds / 60)} min ·{' '}
                  {(dt.distanceMeters / 1000).toFixed(1)} km
                </span>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </>
  );
}
