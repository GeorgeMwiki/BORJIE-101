/**
 * Aggregates the side-effect-free `createRoute` definitions for the
 * migrated mining routes (issue #19) into a single `migratedRoutes`
 * table consumed by `scripts/build-mining-openapi-spec.ts`.
 *
 * Per-domain definitions live in sibling `route-defs-<domain>.ts`
 * files to keep each module under the 300-line limit. The route
 * handlers in `<domain>.hono.ts` import their defs directly from those
 * domain files (never from this barrel) so an unrelated migration does
 * not retrigger their TS check.
 */

export {
  sitesListRoute,
  sitesGetRoute,
  sitesCreateRoute,
  sitesUpdateRoute,
} from './route-defs-sites';
export {
  licencesListRoute,
  licencesGetRoute,
  licencesCreateRoute,
  licencesRenewRoute,
} from './route-defs-licences';
export {
  cockpitDailyBriefRoute,
  cockpitCashRunwayRoute,
  cockpitLicenceHealthRoute,
  cockpitProductionVsTargetRoute,
  cockpitCliffStatusRoute,
} from './route-defs-cockpit';
export { chatTurnRoute } from './route-defs-chat';
export {
  marketplaceListListingsRoute,
  marketplaceGetListingRoute,
} from './route-defs-marketplace';
export {
  bidsPlaceRoute,
  bidsListRoute,
  bidsAcceptRoute,
  bidsRejectRoute,
} from './route-defs-bids';

import {
  sitesListRoute,
  sitesGetRoute,
  sitesCreateRoute,
  sitesUpdateRoute,
} from './route-defs-sites';
import {
  licencesListRoute,
  licencesGetRoute,
  licencesCreateRoute,
  licencesRenewRoute,
} from './route-defs-licences';
import {
  cockpitDailyBriefRoute,
  cockpitCashRunwayRoute,
  cockpitLicenceHealthRoute,
  cockpitProductionVsTargetRoute,
  cockpitCliffStatusRoute,
} from './route-defs-cockpit';
import { chatTurnRoute } from './route-defs-chat';
import {
  marketplaceListListingsRoute,
  marketplaceGetListingRoute,
} from './route-defs-marketplace';
import {
  bidsPlaceRoute,
  bidsListRoute,
  bidsAcceptRoute,
  bidsRejectRoute,
} from './route-defs-bids';

/**
 * Mount table — for each migrated route, the relative path on
 * `mining.route('<mount>', subApp)`. The generator composes
 * `/api/v1/mining{mount}{def.path}` to produce the full OpenAPI path.
 */
export const migratedRoutes = [
  { mount: '/sites', def: sitesListRoute },
  { mount: '/sites', def: sitesGetRoute },
  { mount: '/sites', def: sitesCreateRoute },
  { mount: '/sites', def: sitesUpdateRoute },
  { mount: '/licences', def: licencesListRoute },
  { mount: '/licences', def: licencesGetRoute },
  { mount: '/licences', def: licencesCreateRoute },
  { mount: '/licences', def: licencesRenewRoute },
  { mount: '/cockpit', def: cockpitDailyBriefRoute },
  { mount: '/cockpit', def: cockpitCashRunwayRoute },
  { mount: '/cockpit', def: cockpitLicenceHealthRoute },
  { mount: '/cockpit', def: cockpitProductionVsTargetRoute },
  { mount: '/cockpit', def: cockpitCliffStatusRoute },
  { mount: '/chat', def: chatTurnRoute },
  { mount: '/marketplace', def: marketplaceListListingsRoute },
  { mount: '/marketplace', def: marketplaceGetListingRoute },
  { mount: '/bids', def: bidsPlaceRoute },
  { mount: '/bids', def: bidsListRoute },
  { mount: '/bids', def: bidsAcceptRoute },
  { mount: '/bids', def: bidsRejectRoute },
] as const;
