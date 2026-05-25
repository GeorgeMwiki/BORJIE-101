/**
 * Composite resolver — single source of truth for "which TZ does this
 * user/request belong to?"
 *
 * Priority chain (first match wins):
 *   1. account (explicit DB setting)
 *   2. jwt-claim (`zoneinfo` on access token)
 *   3. browser (`Intl.DateTimeFormat`)
 *   4. ip (GeoIP)
 *   5. jurisdiction (alpha-2 capital-city fallback)
 *   6. UTC (default — never throws)
 *
 * Every layer reports its confidence so the audit trail can attribute
 * the decision back to a source.
 */

import type {
  CompositeDetectionInput,
  DetectionResult,
} from '../types.js';
import { detectFromBrowser } from './detect-from-browser.js';
import { detectFromIP } from './detect-from-ip.js';
import { detectFromJWTClaim } from './detect-from-jwt-claim.js';
import { detectFromJurisdiction } from './detect-from-jurisdiction.js';
import { isValidTimezone } from './validate.js';

export async function detectComposite(
  input: CompositeDetectionInput,
): Promise<DetectionResult> {
  // 1) account
  if (input.account && isValidTimezone(input.account)) {
    return {
      timezone: input.account,
      source: 'account',
      confidence: 1.0,
      reason: 'explicit account/user setting',
    };
  }

  // 2) jwt-claim
  const jwtResult = detectFromJWTClaim(input.jwt ?? null);
  if (jwtResult) return jwtResult;

  // 3) browser
  if (input.browser) {
    const browserResult = detectFromBrowser({
      clientReportedTimezone: input.browser,
    });
    if (browserResult) return browserResult;
  }

  // 4) ip
  if (input.ip) {
    const ipResult = await detectFromIP(input.ip);
    if (ipResult) return ipResult;
  }

  // 5) jurisdiction
  const jurisdictionResult = detectFromJurisdiction(input.jurisdiction ?? null);
  if (jurisdictionResult) return jurisdictionResult;

  // 6) default-utc
  return {
    timezone: 'UTC',
    source: 'default-utc',
    confidence: 0.0,
    reason: 'no detection source was available',
  };
}
