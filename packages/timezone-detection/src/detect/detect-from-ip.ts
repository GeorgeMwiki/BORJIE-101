/**
 * IP-based detection via a pluggable `GeoIPAdapter`.
 *
 * Three real adapters supported (stubs only — wire your provider in the
 * composition root):
 *   1. **MaxMind GeoIP2** — binary `.mmdb` lookups, low latency, paid
 *   2. **ipapi.co** — free tier 1k/day, HTTP REST
 *   3. **ipgeolocation.io** — free tier 1k/day, HTTP REST + ASN data
 *
 * Confidence is 0.7 by default: IP→TZ is unreliable due to mobile
 * carriers + corporate VPNs + Tor + Starlink (which routes through a
 * single PoP). Use browser/account when available.
 */

import type { DetectionResult, GeoIPAdapter, TimezoneId } from '../types.js';
import { isValidTimezone } from './validate.js';

export interface DetectFromIPArgs {
  readonly ip: string;
  readonly geoip: GeoIPAdapter;
}

/**
 * Returns a `DetectionResult` (`source: 'ip'`) or `null` if the adapter
 * could not map the IP. Adapters MUST NOT throw — wrap their HTTP
 * failures and return `null`.
 */
export async function detectFromIP(
  args: DetectFromIPArgs,
): Promise<DetectionResult | null> {
  if (!args.ip) return null;
  let lookup: { timezone: TimezoneId } | null = null;
  try {
    lookup = await args.geoip.lookup(args.ip);
  } catch {
    return null;
  }
  if (!lookup || !isValidTimezone(lookup.timezone)) return null;
  return {
    timezone: lookup.timezone,
    source: 'ip',
    confidence: 0.7,
    reason: `geoip adapter ${args.geoip.name}`,
  };
}

// =============================================================================
// Reference stub adapters — replace in production wiring.
// =============================================================================

/**
 * In-process stub adapter — returns a hard-coded TZ for a hard-coded IP
 * range. Pure function. Used by unit tests and local dev.
 */
export function createStubGeoIPAdapter(
  table: Readonly<Record<string, TimezoneId>>,
): GeoIPAdapter {
  return {
    name: 'stub',
    async lookup(ip: string) {
      const tz = table[ip];
      return tz ? { timezone: tz } : null;
    },
  };
}

/** Sketch of a MaxMind adapter — wire the actual SDK at composition time. */
export function createMaxMindAdapterStub(): GeoIPAdapter {
  return {
    name: 'maxmind',
    async lookup() {
      throw new Error(
        'MaxMind adapter stub — provide a real impl backed by ' +
          '@maxmind/geoip2-node Reader.openBuffer(<your-.mmdb>) at composition time.',
      );
    },
  };
}

/** Sketch of an ipapi.co adapter — wire `fetch` at composition time. */
export function createIpapiAdapterStub(): GeoIPAdapter {
  return {
    name: 'ipapi',
    async lookup() {
      throw new Error(
        'ipapi adapter stub — provide a real impl that calls ' +
          '`fetch("https://ipapi.co/${ip}/timezone/")` at composition time.',
      );
    },
  };
}

/** Sketch of an ipgeolocation.io adapter — wire `fetch` + API key. */
export function createIpgeolocationAdapterStub(): GeoIPAdapter {
  return {
    name: 'ipgeolocation',
    async lookup() {
      throw new Error(
        'ipgeolocation adapter stub — provide a real impl that calls ' +
          '`fetch("https://api.ipgeolocation.io/timezone?apiKey=${key}&ip=${ip}")` ' +
          'at composition time.',
      );
    },
  };
}
