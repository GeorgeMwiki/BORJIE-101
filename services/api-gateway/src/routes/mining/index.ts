// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * Mining-domain Hono sub-app — aggregates every mining route into a
 * single mount-point so `services/api-gateway/src/index.ts` only needs
 * one `api.route('/mining', miningRouter)` call.
 *
 * Sub-routes (one file per resource):
 *   /sites             — sites + site sections
 *   /licences          — TZ mining licences + events
 *   /drill-holes       — geological drill / pit / trench logs
 *   /samples           — lab-bound assay packets
 *   /shift-reports     — supervisor shift roll-ups
 *   /attendance        — GPS-fenced check-in / check-out
 *   /fuel-logs         — fuel issued / consumed per asset
 *   /maintenance       — asset maintenance events
 *   /ore-parcels       — saleable stockpiles + list-for-sale
 *   /sales             — ore-parcel sale transactions
 *   /incidents         — safety incidents
 *   /grievances        — community grievances
 *   /cockpit           — owner cockpit widgets
 *   /chat              — Master Brain SSE stream
 *   /lmbm              — Live Mining Brain Memory (graph)
 *   /documents         — upload / doc-chat / sign
 *   /reports           — report generator
 *   /portfolio-map     — GeoJSON portfolio map
 *   /marketplace       — public listings
 *   /bids              — bids + accept / reject
 *   /buyers/kyc        — buyer KYC submission + status
 *   /internal/*        — admin-console SUPER_ADMIN surfaces
 */

import { Hono } from 'hono';

import { miningSitesRouter } from './sites.hono';
import { miningLicencesRouter } from './licences.hono';
import { miningDrillHolesRouter } from './drill-holes.hono';
import { miningSamplesRouter } from './samples.hono';
import { miningShiftReportsRouter } from './shift-reports.hono';
import { miningAttendanceRouter } from './attendance.hono';
import { miningFuelLogsRouter } from './fuel-logs.hono';
import { miningMaintenanceRouter } from './maintenance.hono';
import { miningOreParcelsRouter } from './ore-parcels.hono';
import { miningSalesRouter } from './sales.hono';
import { miningIncidentsRouter } from './incidents.hono';
import { miningGrievancesRouter } from './grievances.hono';
import { miningCockpitRouter } from './cockpit.hono';
import { miningChatRouter } from './chat.hono';
import { miningLmbmRouter } from './lmbm.hono';
import { miningDocumentsRouter } from './documents.hono';
import { miningReportsRouter } from './reports.hono';
import { miningPortfolioMapRouter } from './portfolio-map.hono';
import { miningMarketplaceRouter } from './marketplace.hono';
import { miningBidsRouter } from './bids.hono';
import { miningBuyersKycRouter } from './buyers-kyc.hono';

import { miningInternalTenantsRouter } from './internal/tenants.hono';
import { miningInternalCorpusRouter } from './internal/corpus.hono';
import { miningInternalPromptsRouter } from './internal/prompts.hono';
import { miningInternalAuditLogRouter } from './internal/audit-log.hono';
import { miningInternalKillswitchRouter } from './internal/killswitch.hono';

const mining = new Hono();

mining.route('/sites', miningSitesRouter);
mining.route('/licences', miningLicencesRouter);
mining.route('/drill-holes', miningDrillHolesRouter);
mining.route('/samples', miningSamplesRouter);
mining.route('/shift-reports', miningShiftReportsRouter);
mining.route('/attendance', miningAttendanceRouter);
mining.route('/fuel-logs', miningFuelLogsRouter);
mining.route('/maintenance', miningMaintenanceRouter);
mining.route('/ore-parcels', miningOreParcelsRouter);
mining.route('/sales', miningSalesRouter);
mining.route('/incidents', miningIncidentsRouter);
mining.route('/grievances', miningGrievancesRouter);
mining.route('/cockpit', miningCockpitRouter);
mining.route('/chat', miningChatRouter);
mining.route('/lmbm', miningLmbmRouter);
mining.route('/documents', miningDocumentsRouter);
mining.route('/reports', miningReportsRouter);
mining.route('/portfolio-map', miningPortfolioMapRouter);
mining.route('/marketplace', miningMarketplaceRouter);
mining.route('/bids', miningBidsRouter);
mining.route('/buyers', miningBuyersKycRouter);

mining.route('/internal/tenants', miningInternalTenantsRouter);
mining.route('/internal/corpus', miningInternalCorpusRouter);
mining.route('/internal/prompts', miningInternalPromptsRouter);
mining.route('/internal/audit-log', miningInternalAuditLogRouter);
mining.route('/internal/killswitch', miningInternalKillswitchRouter);

export const miningRouter = mining;
