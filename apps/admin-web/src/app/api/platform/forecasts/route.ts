/**
 * Platform forecasts proxy.
 *
 *   GET /api/platform/forecasts
 *       → fans out to the three real gateway sub-routes:
 *           GET /api/v1/owner/forecasts/cash-flow?days=90
 *           GET /api/v1/owner/forecasts/production?days=30
 *           GET /api/v1/owner/forecasts/royalty?days=30
 *       then shapes the combined results into
 *           { forecasts: [{ metric, horizon, pointEstimate, intervalLow, intervalHigh, unit }] }
 *       which is what forecasts/page.tsx expects (ForecastPoint[]).
 *
 * When a sub-route errors or returns insufficient data (projection [])
 * that sub-forecast is omitted from the array; the page renders the
 * non-empty subset. When ALL three fail the response is still 200 with
 * an empty array so the page renders the "queue empty" state rather than
 * a degraded banner.
 *
 * Auth: the platform session cookie + Authorization header are forwarded
 * by `proxyJson`.
 */

import { NextResponse } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ForecastPoint {
  readonly t: string;
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
}

interface ForecastEnvelope {
  readonly metric: string;
  readonly unit: string;
  readonly horizonDays: number;
  readonly projection: ReadonlyArray<ForecastPoint>;
  readonly meta?: { readonly source?: string };
}

interface GatewayForecastResponse {
  readonly success?: boolean;
  readonly data?: ForecastEnvelope;
}

interface FlatForecastPoint {
  readonly metric: string;
  readonly horizon: string;
  readonly pointEstimate: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly unit: string;
}

/**
 * Fetch one sub-forecast from the gateway. Returns null on any failure
 * so the caller can skip it without poisoning the whole response.
 */
async function fetchSubForecast(
  base: string,
  path: string,
): Promise<ForecastEnvelope | null> {
  try {
    const res = await proxyJson(`${base}/api/v1/owner/forecasts/${path}`, {
      method: 'GET',
    });
    const body = (await res.json()) as GatewayForecastResponse;
    if (!body?.success || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

/**
 * Collapse a ForecastEnvelope into the flat ForecastPoint shape the
 * forecasts page expects. Uses the midpoint of the final projected step
 * as the point estimate and the matching lower/upper for the interval.
 * Returns null when the projection is empty (insufficient history).
 */
function flattenEnvelope(
  envelope: ForecastEnvelope,
): FlatForecastPoint | null {
  if (!Array.isArray(envelope.projection) || envelope.projection.length === 0) {
    return null;
  }
  const last = envelope.projection[envelope.projection.length - 1];
  if (!last) return null;
  return {
    metric: envelope.metric,
    horizon: `${envelope.horizonDays}d`,
    pointEstimate: last.point,
    intervalLow: last.lower,
    intervalHigh: last.upper,
    unit: envelope.unit,
  };
}

export async function GET(): Promise<NextResponse> {
  const base = getApiGatewayBase();

  const [cashFlow, production, royalty] = await Promise.all([
    fetchSubForecast(base, 'cash-flow?days=90'),
    fetchSubForecast(base, 'production?days=30'),
    fetchSubForecast(base, 'royalty?days=30'),
  ]);

  const forecasts: FlatForecastPoint[] = [];
  for (const envelope of [cashFlow, production, royalty]) {
    if (envelope === null) continue;
    const flat = flattenEnvelope(envelope);
    if (flat !== null) forecasts.push(flat);
  }

  return NextResponse.json({ forecasts }, { status: 200 });
}
