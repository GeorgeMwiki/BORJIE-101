/**
 * `@borjie/timezone-detection` — public barrel.
 *
 * SOTA timezone detection + per-user TZ rendering. Composite priority
 * chain: account > jwt-claim > browser > ip > jurisdiction > UTC.
 *
 *   import { createTimezoneDetection } from '@borjie/timezone-detection';
 *
 *   const tzd = createTimezoneDetection({ geoip: myMaxMindAdapter });
 *   app.use('*', tzd.middleware.hono());
 *   const detected = await tzd.detect({
 *     account: user.timezone,
 *     browser: ctx.req.header('X-Timezone'),
 *     jurisdiction: tenant.jurisdiction,
 *   });
 *   const rendered = tzd.render.renderInTZ(new Date(), detected.timezone, 'yyyy-MM-dd HH:mm ZZ');
 */

export * from './types.js';
export * from './detect/index.js';
export {
  ALL_JURISDICTION_DEFAULTS,
  AFRICA_DEFAULTS,
  REST_OF_WORLD_DEFAULTS,
  JURISDICTION_DEFAULTS_COUNT,
  getJurisdictionDefault,
} from './jurisdiction-defaults/index.js';
export * from './dst-handling/index.js';
export * from './render/index.js';
export * from './middleware/index.js';

import type { GeoIPAdapter } from './types.js';
import { detectComposite } from './detect/detect-composite.js';
import {
  detectFromBrowser,
  detectFromIP,
  detectFromJWTClaim,
  detectFromJurisdiction,
} from './detect/index.js';
import {
  isDSTTransition,
  isInAmbiguousHour,
  resolveAmbiguousHour,
  safeAddDays,
  safeAddMonths,
  timezoneOffsetMinutes,
} from './dst-handling/index.js';
import {
  humanReadable,
  nextOccurrence,
  relativeTime,
  renderInTZ,
} from './render/index.js';
import {
  fastifyTimezonePlugin,
  honoTimezoneMiddleware,
} from './middleware/index.js';

export interface CreateTimezoneDetectionOptions {
  /** Provider for IP→TZ lookups. Skip the layer when omitted. */
  readonly geoip?: GeoIPAdapter;
}

/**
 * Composition root — bundles detection + DST + render + middleware so
 * the api-gateway can wire a single object instead of N imports.
 *
 *   const tzd = createTimezoneDetection({ geoip });
 *   app.use('*', tzd.middleware.hono({ jurisdiction: tenant.code }));
 *   c.get('tz'); // → "Africa/Nairobi"
 */
export function createTimezoneDetection(
  opts: CreateTimezoneDetectionOptions = {},
) {
  return {
    detect: detectComposite,
    detectFromBrowser,
    detectFromIP,
    detectFromJWTClaim,
    detectFromJurisdiction,
    dst: {
      isDSTTransition,
      isInAmbiguousHour,
      resolveAmbiguousHour,
      safeAddDays,
      safeAddMonths,
      timezoneOffsetMinutes,
    },
    render: {
      renderInTZ,
      relativeTime,
      nextOccurrence,
      humanReadable,
    },
    middleware: {
      hono: (extra: Parameters<typeof honoTimezoneMiddleware>[0] = {}) =>
        honoTimezoneMiddleware({
          ...(opts.geoip !== undefined ? { geoip: opts.geoip } : {}),
          ...extra,
        }),
      fastify: (extra: Parameters<typeof fastifyTimezonePlugin>[0] = {}) =>
        fastifyTimezonePlugin({
          ...(opts.geoip !== undefined ? { geoip: opts.geoip } : {}),
          ...extra,
        }),
    },
  };
}
