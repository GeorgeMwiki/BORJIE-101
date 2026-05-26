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
export {
  drillHolesListRoute,
  drillHolesListLayersRoute,
  drillHolesCreateRoute,
  drillHolesCreateLayerRoute,
  samplesListRoute,
  samplesCreateRoute,
  samplesAssayRoute,
  shiftReportsListRoute,
  shiftReportsCreateRoute,
} from './route-defs-field-capture';
export {
  attendanceCheckInRoute,
  attendanceCheckOutRoute,
  fuelLogsCreateRoute,
  maintenanceListRoute,
  maintenanceCreateRoute,
  oreParcelsListRoute,
  oreParcelsCreateRoute,
  oreParcelsListForSaleRoute,
} from './route-defs-operations';
export {
  salesListRoute,
  salesCreateRoute,
  incidentsListRoute,
  incidentsCreateRoute,
  grievancesListRoute,
  grievancesCreateRoute,
} from './route-defs-sales-incidents';
export {
  lmbmGraphRoute,
  lmbmTraverseRoute,
  documentsUploadRoute,
  documentsChatRoute,
  documentsSignRoute,
  reportsGenerateRoute,
  portfolioMapRoute,
  buyersKycSubmitRoute,
  buyersKycStatusRoute,
} from './route-defs-owner-cockpit';
export {
  internalDecisionLogListRoute,
  internalSloListRoute,
  internalKillswitchInitiateRoute,
  internalKillswitchConfirmRoute,
  internalKillswitchListRoute,
  internalKillswitchPendingRoute,
  internalPromotionsListRoute,
  internalRegulatorListRoute,
  internalRegulatorMoveRoute,
  internalCitationsListRoute,
} from './route-defs-internal';
export {
  internalComplianceListRoute,
  internalComplianceApproveRoute,
  internalComplianceRejectRoute,
  internalTenantsListRoute,
  internalTenantsProvisionRoute,
  internalTenantsUpdateRoute,
  internalTenantsSuspendRoute,
} from './route-defs-internal-platform';
export {
  internalCorpusUploadRoute,
  internalCorpusSupersedeRoute,
  internalCorpusVersionsRoute,
  internalPromptsListRoute,
  internalPromptsPromoteRoute,
  internalAuditLogListRoute,
} from './route-defs-internal-corpus';

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
import {
  drillHolesListRoute,
  drillHolesListLayersRoute,
  drillHolesCreateRoute,
  drillHolesCreateLayerRoute,
  samplesListRoute,
  samplesCreateRoute,
  samplesAssayRoute,
  shiftReportsListRoute,
  shiftReportsCreateRoute,
} from './route-defs-field-capture';
import {
  attendanceCheckInRoute,
  attendanceCheckOutRoute,
  fuelLogsCreateRoute,
  maintenanceListRoute,
  maintenanceCreateRoute,
  oreParcelsListRoute,
  oreParcelsCreateRoute,
  oreParcelsListForSaleRoute,
} from './route-defs-operations';
import {
  salesListRoute,
  salesCreateRoute,
  incidentsListRoute,
  incidentsCreateRoute,
  grievancesListRoute,
  grievancesCreateRoute,
} from './route-defs-sales-incidents';
import {
  lmbmGraphRoute,
  lmbmTraverseRoute,
  documentsUploadRoute,
  documentsChatRoute,
  documentsSignRoute,
  reportsGenerateRoute,
  portfolioMapRoute,
  buyersKycSubmitRoute,
  buyersKycStatusRoute,
} from './route-defs-owner-cockpit';
import {
  internalDecisionLogListRoute,
  internalSloListRoute,
  internalKillswitchInitiateRoute,
  internalKillswitchConfirmRoute,
  internalKillswitchListRoute,
  internalKillswitchPendingRoute,
  internalPromotionsListRoute,
  internalRegulatorListRoute,
  internalRegulatorMoveRoute,
  internalCitationsListRoute,
} from './route-defs-internal';
import {
  internalComplianceListRoute,
  internalComplianceApproveRoute,
  internalComplianceRejectRoute,
  internalTenantsListRoute,
  internalTenantsProvisionRoute,
  internalTenantsUpdateRoute,
  internalTenantsSuspendRoute,
} from './route-defs-internal-platform';
import {
  internalCorpusUploadRoute,
  internalCorpusSupersedeRoute,
  internalCorpusVersionsRoute,
  internalPromptsListRoute,
  internalPromptsPromoteRoute,
  internalAuditLogListRoute,
} from './route-defs-internal-corpus';

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
  { mount: '/drill-holes', def: drillHolesListRoute },
  { mount: '/drill-holes', def: drillHolesListLayersRoute },
  { mount: '/drill-holes', def: drillHolesCreateRoute },
  { mount: '/drill-holes', def: drillHolesCreateLayerRoute },
  { mount: '/samples', def: samplesListRoute },
  { mount: '/samples', def: samplesCreateRoute },
  { mount: '/samples', def: samplesAssayRoute },
  { mount: '/shift-reports', def: shiftReportsListRoute },
  { mount: '/shift-reports', def: shiftReportsCreateRoute },
  { mount: '/attendance', def: attendanceCheckInRoute },
  { mount: '/attendance', def: attendanceCheckOutRoute },
  { mount: '/fuel-logs', def: fuelLogsCreateRoute },
  { mount: '/maintenance', def: maintenanceListRoute },
  { mount: '/maintenance', def: maintenanceCreateRoute },
  { mount: '/ore-parcels', def: oreParcelsListRoute },
  { mount: '/ore-parcels', def: oreParcelsCreateRoute },
  { mount: '/ore-parcels', def: oreParcelsListForSaleRoute },
  { mount: '/sales', def: salesListRoute },
  { mount: '/sales', def: salesCreateRoute },
  { mount: '/incidents', def: incidentsListRoute },
  { mount: '/incidents', def: incidentsCreateRoute },
  { mount: '/grievances', def: grievancesListRoute },
  { mount: '/grievances', def: grievancesCreateRoute },
  { mount: '/lmbm', def: lmbmGraphRoute },
  { mount: '/lmbm', def: lmbmTraverseRoute },
  { mount: '/documents', def: documentsUploadRoute },
  { mount: '/documents', def: documentsChatRoute },
  { mount: '/documents', def: documentsSignRoute },
  { mount: '/reports', def: reportsGenerateRoute },
  { mount: '/portfolio-map', def: portfolioMapRoute },
  { mount: '/buyers', def: buyersKycSubmitRoute },
  { mount: '/buyers', def: buyersKycStatusRoute },
  { mount: '/internal/decision-log', def: internalDecisionLogListRoute },
  { mount: '/internal/slo', def: internalSloListRoute },
  { mount: '/internal/killswitch', def: internalKillswitchInitiateRoute },
  { mount: '/internal/killswitch', def: internalKillswitchConfirmRoute },
  { mount: '/internal/killswitch', def: internalKillswitchListRoute },
  { mount: '/internal/killswitch', def: internalKillswitchPendingRoute },
  { mount: '/internal/promotions', def: internalPromotionsListRoute },
  { mount: '/internal/regulator-pipeline', def: internalRegulatorListRoute },
  { mount: '/internal/regulator-pipeline', def: internalRegulatorMoveRoute },
  { mount: '/internal/citations', def: internalCitationsListRoute },
  { mount: '/internal/compliance-queue', def: internalComplianceListRoute },
  { mount: '/internal/compliance-queue', def: internalComplianceApproveRoute },
  { mount: '/internal/compliance-queue', def: internalComplianceRejectRoute },
  { mount: '/internal/tenants', def: internalTenantsListRoute },
  { mount: '/internal/tenants', def: internalTenantsProvisionRoute },
  { mount: '/internal/tenants', def: internalTenantsUpdateRoute },
  { mount: '/internal/tenants', def: internalTenantsSuspendRoute },
  { mount: '/internal/corpus', def: internalCorpusUploadRoute },
  { mount: '/internal/corpus', def: internalCorpusSupersedeRoute },
  { mount: '/internal/corpus', def: internalCorpusVersionsRoute },
  { mount: '/internal/prompts', def: internalPromptsListRoute },
  { mount: '/internal/prompts', def: internalPromptsPromoteRoute },
  { mount: '/internal/audit-log', def: internalAuditLogListRoute },
] as const;
