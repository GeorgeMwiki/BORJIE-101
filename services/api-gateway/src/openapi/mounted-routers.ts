/**
 * Shared catalog of mounted-router entries.
 *
 * Lives in its own module so both `index.ts` (the live gateway) and
 * `export-cli.ts` (the offline spec emitter) consume the same prefix
 * map. Avoids drift where the CLI emits a spec for a router set that
 * no longer matches what the gateway serves.
 *
 * Import paths mirror `index.ts` exactly — any new router wired there
 * should also be added here. The harvester tolerates duplicates and
 * warns for prefix/handler mismatches.
 */

import { authRouter } from '../routes/auth';
import { authMfaRouter } from '../routes/auth-mfa';
import { tenantsRouter } from '../routes/tenants.hono';
import { usersRouter } from '../routes/users.hono';
import { propertiesRouter } from '../routes/properties';
import { unitsRouter } from '../routes/units';
import { customersRouter } from '../routes/customers';
import { leasesRouter } from '../routes/leases';
import { invoicesApp } from '../routes/invoices';
import { paymentsApp } from '../routes/payments';
import { workOrdersRouter } from '../routes/work-orders.hono';
import { vendorsRouter } from '../routes/vendors.hono';
import { notificationsRouter } from '../routes/notifications';
import { reportsHonoRouter } from '../routes/reports.hono';
import { dashboardRouter } from '../routes/dashboard.hono';
import { onboardingRouter } from '../routes/onboarding';
import { feedbackRouter } from '../routes/feedback';
import { complaintsRouter } from '../routes/complaints';
import { inspectionsRouter } from '../routes/inspections';
import { documentsHonoRouter } from '../routes/documents.hono';
import { schedulingRouter } from '../routes/scheduling';
import { messagingRouter } from '../routes/messaging';
import { casesRouter } from '../routes/cases.hono';
import { brainRouter } from '../routes/brain.hono';
import { maintenanceRouter } from '../routes/maintenance.hono';
import { hrRouter } from '../routes/hr.hono';
import applicationsRouter from '../routes/applications.router';
import arrearsRouter from '../routes/arrears.router';
import complianceRouter from '../routes/compliance.router';
import docChatRouter from '../routes/doc-chat.router';
import documentRenderRouter from '../routes/document-render.router';
import financialProfileRouter from '../routes/financial-profile.router';
import gamificationRouter from '../routes/gamification.router';
import gepgRouter from '../routes/gepg.router';
import interactiveReportsRouter from '../routes/interactive-reports.router';
import lettersRouter from '../routes/letters.router';
import { marketplaceRouter } from '../routes/marketplace.router';
import { universalMarketplaceRouter } from '../routes/marketplace/index.js';
import { negotiationsRouter } from '../routes/negotiations.router';
import occupancyTimelineRouter from '../routes/occupancy-timeline.router';
import renewalsRouter from '../routes/renewals.router';
import riskReportsRouter from '../routes/risk-reports.router';
import scansRouter from '../routes/scans.router';
import stationMasterCoverageRouter from '../routes/station-master-coverage.router';
import { tendersRouter } from '../routes/tenders.router';
import { waitlistRouter } from '../routes/waitlist.router';

import type { MountedRouter } from './route-harvester';

/**
 * Build the catalog. Called once at boot (from `index.ts`) and again
 * by the export CLI. Returns a NEW array each invocation so callers
 * can safely mutate (e.g. adding runtime-assembled routers like
 * notification-preferences).
 */
export function buildStaticRouterCatalog(): MountedRouter[] {
  return [
    { prefix: '/auth', app: authRouter, defaultTag: 'auth' },
    { prefix: '/auth/mfa', app: authMfaRouter, defaultTag: 'auth' },
    { prefix: '/tenants', app: tenantsRouter, defaultTag: 'tenants' },
    { prefix: '/users', app: usersRouter, defaultTag: 'users' },
    { prefix: '/properties', app: propertiesRouter, defaultTag: 'properties' },
    { prefix: '/units', app: unitsRouter, defaultTag: 'units' },
    { prefix: '/customers', app: customersRouter, defaultTag: 'customers' },
    { prefix: '/leases', app: leasesRouter, defaultTag: 'leases' },
    { prefix: '/invoices', app: invoicesApp, defaultTag: 'invoices' },
    { prefix: '/payments', app: paymentsApp, defaultTag: 'payments' },
    { prefix: '/work-orders', app: workOrdersRouter, defaultTag: 'work-orders' },
    { prefix: '/vendors', app: vendorsRouter, defaultTag: 'vendors' },
    { prefix: '/notifications', app: notificationsRouter, defaultTag: 'notifications' },
    { prefix: '/reports', app: reportsHonoRouter, defaultTag: 'reports' },
    { prefix: '/dashboard', app: dashboardRouter, defaultTag: 'dashboard' },
    { prefix: '/onboarding', app: onboardingRouter, defaultTag: 'onboarding' },
    { prefix: '/feedback', app: feedbackRouter, defaultTag: 'feedback' },
    { prefix: '/complaints', app: complaintsRouter, defaultTag: 'complaints' },
    { prefix: '/inspections', app: inspectionsRouter, defaultTag: 'inspections' },
    { prefix: '/documents', app: documentsHonoRouter, defaultTag: 'documents' },
    { prefix: '/scheduling', app: schedulingRouter, defaultTag: 'scheduling' },
    { prefix: '/messaging', app: messagingRouter, defaultTag: 'messaging' },
    { prefix: '/cases', app: casesRouter, defaultTag: 'cases' },
    { prefix: '/brain', app: brainRouter, defaultTag: 'brain' },
    { prefix: '/maintenance', app: maintenanceRouter, defaultTag: 'maintenance' },
    { prefix: '/hr', app: hrRouter, defaultTag: 'hr' },
    { prefix: '/applications', app: applicationsRouter, defaultTag: 'applications' },
    { prefix: '/arrears', app: arrearsRouter, defaultTag: 'arrears' },
    { prefix: '/compliance', app: complianceRouter, defaultTag: 'compliance' },
    { prefix: '/doc-chat', app: docChatRouter, defaultTag: 'doc-chat' },
    { prefix: '/document-render', app: documentRenderRouter, defaultTag: 'document-render' },
    { prefix: '/financial-profile', app: financialProfileRouter, defaultTag: 'financial-profile' },
    { prefix: '/gamification', app: gamificationRouter, defaultTag: 'gamification' },
    { prefix: '/gepg', app: gepgRouter, defaultTag: 'gepg' },
    { prefix: '/interactive-reports', app: interactiveReportsRouter, defaultTag: 'interactive-reports' },
    { prefix: '/letters', app: lettersRouter, defaultTag: 'letters' },
    { prefix: '/marketplace', app: marketplaceRouter, defaultTag: 'marketplace' },
    { prefix: '/marketplace-universal', app: universalMarketplaceRouter, defaultTag: 'marketplace-universal' },
    { prefix: '/negotiations', app: negotiationsRouter, defaultTag: 'negotiations' },
    { prefix: '/occupancy-timeline', app: occupancyTimelineRouter, defaultTag: 'occupancy-timeline' },
    { prefix: '/renewals', app: renewalsRouter, defaultTag: 'renewals' },
    { prefix: '/risk-reports', app: riskReportsRouter, defaultTag: 'risk-reports' },
    { prefix: '/scans', app: scansRouter, defaultTag: 'scans' },
    { prefix: '/station-master-coverage', app: stationMasterCoverageRouter, defaultTag: 'station-master-coverage' },
    { prefix: '/tenders', app: tendersRouter, defaultTag: 'tenders' },
    { prefix: '/waitlist', app: waitlistRouter, defaultTag: 'waitlist' },
  ];
}
