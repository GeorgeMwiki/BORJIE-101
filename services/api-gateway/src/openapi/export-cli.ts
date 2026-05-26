/**
 * OpenAPI export CLI — writes the live-generated spec to disk so CI
 * can diff it against the committed copy and so API consumers can
 * bundle the spec without booting the gateway.
 *
 * Run via: `pnpm -F @borjie/api-gateway openapi:export`
 *
 * Output path: `Docs/api/openapi.generated.json` (monorepo root).
 *
 * The script imports the compiled router graph to harvest routes. It
 * stubs out env-var preconditions (API keys, DB URL) so it can run
 * without a full boot — the schemas and route shapes are static.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';
import { generateOpenApiDocument } from '../openapi';
import type { MountedRouter } from './route-harvester';

// Relax preconditions for CLI use — we do NOT want to require
// DATABASE_URL or INTERNAL_API_KEY just to emit a spec. CLI is
// strictly a build-time code-generation tool and refuses to run in
// production.
if (process.env.NODE_ENV === 'production') {
  throw new Error('export-cli.ts is a build-time tool and must not run with NODE_ENV=production');
}
process.env.OUTBOX_WORKER_DISABLED = 'true';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000';
if (!process.env.INTERNAL_API_KEY) process.env.INTERNAL_API_KEY = 'dev-cli-export-key';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'dev-cli-export-secret';

// Lazy imports so env defaults above land before module init.
type RouterModule = { default?: unknown } & Record<string, unknown>;

async function loadRouters(): Promise<MountedRouter[]> {
  const [
    auth,
    authMfa,
    tenants,
    users,
    properties,
    units,
    customers,
    leases,
    invoices,
    payments,
    workOrders,
    vendors,
    notifications,
    reports,
    dashboard,
    onboarding,
    feedback,
    complaints,
    inspections,
    documents,
    scheduling,
    messaging,
    cases,
    brain,
    maintenance,
    hr,
    applications,
    arrears,
    compliance,
    docChat,
    documentRender,
    financialProfile,
    gamification,
    gepg,
    interactiveReports,
    letters,
    marketplace,
    negotiations,
    occupancyTimeline,
    renewals,
    riskReports,
    scans,
    stationMasterCoverage,
    tenders,
    waitlist,
  ] = await Promise.all([
    import('../routes/auth.js'),
    import('../routes/auth-mfa.js'),
    import('../routes/tenants.hono.js'),
    import('../routes/users.hono.js'),
    import('../routes/properties.js'),
    import('../routes/units.js'),
    import('../routes/customers.js'),
    import('../routes/leases.js'),
    import('../routes/invoices.js'),
    import('../routes/payments.js'),
    import('../routes/work-orders.hono.js'),
    import('../routes/vendors.hono.js'),
    import('../routes/notifications.js'),
    import('../routes/reports.hono.js'),
    import('../routes/dashboard.hono.js'),
    import('../routes/onboarding.js'),
    import('../routes/feedback.js'),
    import('../routes/complaints.js'),
    import('../routes/inspections.js'),
    import('../routes/documents.hono.js'),
    import('../routes/scheduling.js'),
    import('../routes/messaging.js'),
    import('../routes/cases.hono.js'),
    import('../routes/brain.hono.js'),
    import('../routes/maintenance.hono.js'),
    import('../routes/hr.hono.js'),
    import('../routes/applications.router.js'),
    import('../routes/arrears.router.js'),
    import('../routes/compliance.router.js'),
    import('../routes/doc-chat.router.js'),
    import('../routes/document-render.router.js'),
    import('../routes/financial-profile.router.js'),
    import('../routes/gamification.router.js'),
    import('../routes/gepg.router.js'),
    import('../routes/interactive-reports.router.js'),
    import('../routes/letters.router.js'),
    import('../routes/marketplace.router.js'),
    import('../routes/negotiations.router.js'),
    import('../routes/occupancy-timeline.router.js'),
    import('../routes/renewals.router.js'),
    import('../routes/risk-reports.router.js'),
    import('../routes/scans.router.js'),
    import('../routes/station-master-coverage.router.js'),
    import('../routes/tenders.router.js'),
    import('../routes/waitlist.router.js'),
  ]);

  // Routers are exported under inconsistent names (default export vs.
  // named export like `authRouter`, `fooApp`). Pick the first Hono
  // instance from each module.
  const pick = (mod: RouterModule, preferred: string[] = []): Hono | undefined => {
    for (const k of preferred) if (mod[k]) return mod[k] as Hono;
    if (mod.default) return mod.default as Hono;
    for (const v of Object.values(mod)) if (v && typeof v === 'object' && 'routes' in (v as object)) return v as Hono;
    return undefined;
  };

  const entries: Array<[string, RouterModule, string[], string]> = [
    ['/auth', auth, ['authRouter'], 'auth'],
    ['/auth/mfa', authMfa, ['authMfaRouter'], 'auth'],
    ['/tenants', tenants, ['tenantsRouter'], 'tenants'],
    ['/users', users, ['usersRouter'], 'users'],
    ['/properties', properties, ['propertiesRouter'], 'properties'],
    ['/units', units, ['unitsRouter'], 'units'],
    ['/customers', customers, ['customersRouter'], 'customers'],
    ['/leases', leases, ['leasesRouter'], 'leases'],
    ['/invoices', invoices, ['invoicesApp'], 'invoices'],
    ['/payments', payments, ['paymentsApp'], 'payments'],
    ['/work-orders', workOrders, ['workOrdersRouter'], 'work-orders'],
    ['/vendors', vendors, ['vendorsRouter'], 'vendors'],
    ['/notifications', notifications, ['notificationsRouter'], 'notifications'],
    ['/reports', reports, ['reportsHonoRouter'], 'reports'],
    ['/dashboard', dashboard, ['dashboardRouter'], 'dashboard'],
    ['/onboarding', onboarding, ['onboardingRouter'], 'onboarding'],
    ['/feedback', feedback, ['feedbackRouter'], 'feedback'],
    ['/complaints', complaints, ['complaintsRouter'], 'complaints'],
    ['/inspections', inspections, ['inspectionsRouter'], 'inspections'],
    ['/documents', documents, ['documentsHonoRouter'], 'documents'],
    ['/scheduling', scheduling, ['schedulingRouter'], 'scheduling'],
    ['/messaging', messaging, ['messagingRouter'], 'messaging'],
    ['/cases', cases, ['casesRouter'], 'cases'],
    ['/brain', brain, ['brainRouter'], 'brain'],
    ['/maintenance', maintenance, ['maintenanceRouter'], 'maintenance'],
    ['/hr', hr, ['hrRouter'], 'hr'],
    ['/applications', applications, [], 'applications'],
    ['/arrears', arrears, [], 'arrears'],
    ['/compliance', compliance, [], 'compliance'],
    ['/doc-chat', docChat, [], 'doc-chat'],
    ['/document-render', documentRender, [], 'document-render'],
    ['/financial-profile', financialProfile, [], 'financial-profile'],
    ['/gamification', gamification, [], 'gamification'],
    ['/gepg', gepg, [], 'gepg'],
    ['/interactive-reports', interactiveReports, [], 'interactive-reports'],
    ['/letters', letters, [], 'letters'],
    ['/marketplace', marketplace, ['marketplaceRouter'], 'marketplace'],
    ['/negotiations', negotiations, ['negotiationsRouter'], 'negotiations'],
    ['/occupancy-timeline', occupancyTimeline, [], 'occupancy-timeline'],
    ['/renewals', renewals, [], 'renewals'],
    ['/risk-reports', riskReports, [], 'risk-reports'],
    ['/scans', scans, [], 'scans'],
    ['/station-master-coverage', stationMasterCoverage, [], 'station-master-coverage'],
    ['/tenders', tenders, ['tendersRouter'], 'tenders'],
    ['/waitlist', waitlist, ['waitlistRouter'], 'waitlist'],
  ];

  const mounted: MountedRouter[] = [];
  for (const [prefix, mod, preferred, defaultTag] of entries) {
    const app = pick(mod as RouterModule, preferred);
    if (app) mounted.push({ prefix, app, defaultTag });
    else {
      // eslint-disable-next-line no-console
      console.warn(`openapi-export: could not resolve a Hono app for prefix ${prefix}`);
    }
  }
  return mounted;
}

async function main(): Promise<void> {
  const outputPath =
    process.argv[2] ??
    resolve(process.cwd(), '..', '..', 'Docs', 'api', 'openapi.generated.json');

  // Ensure manifests register before spec generation.
  await import('./manifests.js');

  const routers = await loadRouters();
  const spec = generateOpenApiDocument({
    title: 'BORJIE API',
    version: process.env.APP_VERSION ?? '1.0.0',
    description:
      'BORJIE multi-tenant property management platform — full HTTP API. ' +
      'Generated from the gateway source at build time.',
    servers: [
      { url: '/api/v1', description: 'Default' },
    ],
    mountedRouters: routers,
  });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- outputPath is a CLI-arg-derived path scoped to the build dir, validated by the caller; no untrusted input reaches the fs.
  await mkdir(dirname(outputPath), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same: outputPath is a build artifact path, not user-influenced at runtime.
  await writeFile(outputPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');

  const pathCount = Object.keys((spec as { paths?: Record<string, unknown> }).paths ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(`openapi-export: wrote ${pathCount} paths to ${outputPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('openapi-export failed:', err);
  process.exit(1);
});
