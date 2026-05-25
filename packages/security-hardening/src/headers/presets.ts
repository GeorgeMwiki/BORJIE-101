/**
 * Browser security-headers presets.
 *
 * Defaults trace the OWASP Secure Headers Project + Mozilla
 * Observatory + web.dev's 2026 "secure context" baselines:
 *
 *   - HSTS:   2-year max-age, includeSubDomains, preload-eligible
 *   - CSP:    strict — `default-src 'self'`; production blocks all
 *             inline script; dev allows `'unsafe-inline'` + WS for HMR.
 *   - COEP:   require-corp — enables `crossOriginIsolated` for
 *             `SharedArrayBuffer` & Wasm SIMD perf wins.
 *   - COOP:   same-origin — blocks Spectre-style cross-origin leaks.
 *   - CORP:   same-origin — opaque responses cannot be embedded
 *             unless the resource opts in.
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: deny geolocation/camera/mic/payment by
 *             default; routes can override per-route.
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (legacy fallback alongside CSP
 *             frame-ancestors directive).
 */

import type {
  SecurityHeadersConfig,
  SecurityHeaderEnv,
} from '../types.js';

const DEFAULT_PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=(self)',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

const STRICT_CSP_PROD = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'", // OK only because we ship hashed CSS
  "script-src 'self'",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

const STRICT_CSP_DEV = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Dev tools + HMR require inline + eval + ws/wss.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
].join('; ');

function defaultCspFor(env: SecurityHeaderEnv): string {
  return env === 'development' ? STRICT_CSP_DEV : STRICT_CSP_PROD;
}

/**
 * Build the full headers map for the given config — pure, side-effect-free.
 * The middleware factory (`./middleware.ts`) wraps this in a Hono-shaped
 * function but the underlying logic is here for unit-testability.
 */
export function buildSecurityHeaders(
  config: SecurityHeadersConfig,
): Readonly<Record<string, string>> {
  const csp = config.csp ?? defaultCspFor(config.env);
  const headers: Record<string, string> = {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy':
      config.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY,
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };

  if (!config.disableCoep) {
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
  }
  if (!config.disableHsts && config.env !== 'development') {
    headers['Strict-Transport-Security'] =
      'max-age=63072000; includeSubDomains; preload';
  }
  if (config.extra) {
    for (const [k, v] of Object.entries(config.extra)) {
      headers[k] = v;
    }
  }
  return headers;
}

/**
 * Merge a per-route override on top of a base config without mutating
 * the base — needed because individual routes (`/oauth/callback`,
 * `/embed`) often need a relaxed CSP or a different Permissions-Policy.
 */
export function withRouteOverride(
  base: SecurityHeadersConfig,
  override: Partial<SecurityHeadersConfig>,
): SecurityHeadersConfig {
  return {
    ...base,
    ...override,
    extra: {
      ...(base.extra ?? {}),
      ...(override.extra ?? {}),
    },
  };
}
