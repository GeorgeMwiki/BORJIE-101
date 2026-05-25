/**
 * VIN decoder — calls the NHTSA public vPIC API.
 *
 *   GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/{vin}?format=json
 *
 * The API is free, key-less, rate-limit ~50 req/sec, returns a fixed
 * column set. We extract Make/Model/Year/BodyClass/FuelType/Engine and
 * map them to our `VehicleType`/`FuelType` taxonomy.
 *
 * Network calls are abstracted behind a `fetch`-shaped port so tests
 * stub the response without touching the wire. An in-memory cache
 * keyed by VIN (case-folded) prevents duplicate calls in a hot loop.
 */

import { type VehicleSpec, type VehicleType, type FuelType } from '../types.js';

export type FetchLike = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended';

/** Year-of-manufacture validation — keeps test fixtures sane. */
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 1;

/** Basic NHTSA structural check. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{11,17}$/;

interface NhtsaResult {
  readonly Make?: string;
  readonly Model?: string;
  readonly ModelYear?: string;
  readonly BodyClass?: string;
  readonly FuelTypePrimary?: string;
  readonly EngineCylinders?: string;
  readonly DisplacementL?: string;
  readonly PlantCountry?: string;
  readonly ErrorCode?: string;
  readonly ErrorText?: string;
}

interface NhtsaEnvelope {
  readonly Results?: ReadonlyArray<NhtsaResult>;
}

function normaliseFuelType(raw: string | undefined): FuelType | 'unknown' {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase();
  if (v.includes('gasoline') || v.includes('petrol')) return 'petrol';
  if (v.includes('diesel')) return 'diesel';
  if (v.includes('electric') && !v.includes('hybrid')) return 'electric';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('cng') || v.includes('compressed natural gas')) return 'cng';
  return 'unknown';
}

function normaliseVehicleType(raw: string | undefined): VehicleType | 'unknown' {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase();
  if (v.includes('motorcycle')) return 'motorcycle';
  if (v.includes('scooter') || v.includes('moped')) return 'scooter';
  if (v.includes('sport utility') || v.includes('suv') || v.includes('crossover')) return 'suv';
  if (v.includes('pickup') || v.includes('truck — light')) return 'pickup';
  if (v.includes('truck') || v.includes('lorry')) return 'truck';
  if (v.includes('van') || v.includes('minivan')) return 'van';
  if (v.includes('sedan') || v.includes('coupe') || v.includes('hatchback')) return 'sedan';
  return 'unknown';
}

export class VinDecodeError extends Error {
  constructor(message: string, readonly vin: string) {
    super(message);
    this.name = 'VinDecodeError';
  }
}

export interface VinDecoderOptions {
  readonly fetch?: FetchLike;
  readonly cache?: Map<string, VehicleSpec>;
  readonly timeoutMs?: number;
  readonly stubOnFailure?: boolean;
}

/**
 * Decode a VIN. Returns a stub `VehicleSpec` (source: 'stub') if the
 * NHTSA call fails AND `stubOnFailure` is true; otherwise throws.
 */
export async function decodeVin(
  vin: string,
  options: VinDecoderOptions = {},
): Promise<VehicleSpec> {
  const trimmed = vin.trim().toUpperCase();
  if (!VIN_PATTERN.test(trimmed)) {
    throw new VinDecodeError(`Invalid VIN format: ${trimmed}`, trimmed);
  }

  const cache = options.cache;
  if (cache?.has(trimmed)) {
    const cached = cache.get(trimmed)!;
    return { ...cached, source: 'cache' };
  }

  const f: FetchLike = options.fetch
    ?? ((typeof fetch === 'function' ? fetch : undefined) as FetchLike | undefined)
    ?? (async () => { throw new Error('fetch unavailable; supply options.fetch'); });

  const url = `${NHTSA_BASE}/${encodeURIComponent(trimmed)}?format=json`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 5_000);
    let res;
    try {
      res = await f(url);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new VinDecodeError(`NHTSA HTTP ${res.status}`, trimmed);
    }
    const body = (await res.json()) as NhtsaEnvelope;
    const result = body.Results?.[0];
    if (!result) {
      throw new VinDecodeError('NHTSA returned no rows', trimmed);
    }
    const yearN = result.ModelYear ? Number.parseInt(result.ModelYear, 10) : NaN;
    const safeYear = Number.isInteger(yearN) && yearN >= MIN_YEAR && yearN <= MAX_YEAR
      ? yearN
      : new Date().getFullYear();
    const spec: VehicleSpec = {
      vin: trimmed,
      make: result.Make?.trim() || 'unknown',
      model: result.Model?.trim() || 'unknown',
      year: safeYear,
      type: normaliseVehicleType(result.BodyClass),
      fuelType: normaliseFuelType(result.FuelTypePrimary),
      ...(result.EngineCylinders
        ? { engineCylinders: Number.parseInt(result.EngineCylinders, 10) || undefined }
        : {}),
      ...(result.DisplacementL
        ? { displacementL: Number.parseFloat(result.DisplacementL) || undefined }
        : {}),
      ...(result.BodyClass ? { bodyClass: result.BodyClass } : {}),
      ...(result.PlantCountry ? { plantCountry: result.PlantCountry } : {}),
      source: 'nhtsa',
    };
    cache?.set(trimmed, spec);
    return spec;
  } catch (err) {
    if (options.stubOnFailure) {
      return {
        vin: trimmed,
        make: 'unknown',
        model: 'unknown',
        year: new Date().getFullYear(),
        type: 'unknown',
        fuelType: 'unknown',
        source: 'stub',
      };
    }
    if (err instanceof VinDecodeError) throw err;
    throw new VinDecodeError(
      `VIN decode failed: ${(err as Error).message ?? String(err)}`,
      trimmed,
    );
  }
}
