/**
 * @borjie/maps/react — entry for the web React binding.
 *
 * Consumers (apps/owner-web, apps/admin-web, apps/buyer-mobile when
 * running on web) import from here:
 *
 *   import { BorjieMap } from '@borjie/maps/react';
 *
 * The companion @borjie/maps/native module exposes the same surface
 * for React Native consumers (apps/workforce-mobile, apps/buyer-mobile).
 */

export { BorjieMap, colorForLayer, labelForMarker } from './BorjieMap.js';
export * from '../types/index.js';
