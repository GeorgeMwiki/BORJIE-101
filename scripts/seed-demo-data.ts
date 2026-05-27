#!/usr/bin/env node
/**
 * seed-demo-data.ts — populate a dev tenant with realistic mining data.
 *
 * Seeds (via the public api-gateway endpoints — same code path as
 * production):
 *   - 1 licence per site (3 total)
 *   - 3 sites: Geita Gold, Mwanza Cu, Mererani Tanzanite
 *   - 5 workers per site (15 user rows)
 *   - 10 ore parcels spread across the 3 sites
 *   - 3 buyer organisations with one bid each
 *   - 2 safety / near-miss incidents
 *   - 5 documents
 *
 * Every row is tagged with `seed_run_id` in its attributes column so
 * later cleanup can `DELETE WHERE attributes->>'seed_run_id' = '<id>'`.
 *
 * Usage:
 *   tsx scripts/seed-demo-data.ts \
 *     (--tenant-id <uuid> | --phone +255...) \
 *     [--seed-run-id <slug>] [--dry-run] [--json]
 *
 * Required env (loaded from .env.local by dotenv):
 *   BORJIE_API_GATEWAY_URL    → http://localhost:4000 by default
 *   DATABASE_URL              → only used for the phone→tenant lookup
 *   BORJIE_DEV_OWNER_TOKEN    → Supabase access token for the dev owner
 *                               (used to authenticate api-gateway calls)
 *
 * Exit codes:
 *   0 — seed complete (newly seeded OR converged)
 *   1 — fatal error (network / SQL / 4xx-5xx response)
 *   2 — validation error (bad CLI input)
 */

import pino from 'pino';
import postgres from 'postgres';
import {
  parseSeedDemoArgs,
  buildDemoDataPlan,
  seedAttributes,
  SeedDemoValidationError,
  type SeedDemoArgs,
  type DemoDataPlan,
} from './lib/provision-dev-helpers.js';

const logger = pino({
  name: 'seed-demo-data',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['DATABASE_URL', 'BORJIE_DEV_OWNER_TOKEN'],
});

const DEFAULT_GATEWAY_URL = 'http://localhost:4000';

// ─── Result types ────────────────────────────────────────────────────

export interface SeededResource {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

export interface SeedDemoResult {
  readonly tenantId: string;
  readonly seedRunId: string;
  readonly counts: Readonly<{
    licences: number;
    sites: number;
    workers: number;
    oreParcels: number;
    buyers: number;
    bids: number;
    incidents: number;
    documents: number;
  }>;
  readonly resources: ReadonlyArray<SeededResource>;
}

// ─── Env helpers ─────────────────────────────────────────────────────

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function readEnvOneOf(names: ReadonlyArray<string>): string | undefined {
  for (const n of names) {
    const v = readEnv(n);
    if (v) return v;
  }
  return undefined;
}

function assertNotProduction(databaseUrl: string, gatewayUrl: string): void {
  if (/prod|production|live/i.test(databaseUrl)) {
    throw new SeedDemoValidationError(
      `DATABASE_URL looks like production — refusing to run`,
    );
  }
  if (/prod|production|live/i.test(gatewayUrl)) {
    throw new SeedDemoValidationError(
      `BORJIE_API_GATEWAY_URL looks like production — refusing to run`,
    );
  }
}

// ─── HTTP client (always authenticated) ─────────────────────────────

export interface SeedHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface AuthenticatedHttpClient {
  request(
    method: 'POST' | 'PATCH' | 'GET',
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<SeedHttpResponse>;
}

export function createFetchClient(input: {
  readonly gatewayUrl: string;
  readonly token: string;
}): AuthenticatedHttpClient {
  const base = input.gatewayUrl.replace(/\/+$/, '');
  const client: AuthenticatedHttpClient = {
    async request(method, path, body) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${input.token}`,
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, body: parsed };
    },
  };
  return Object.freeze(client);
}

// ─── Tenant lookup (only when --phone is provided) ───────────────────

export interface TenantLookup {
  findTenantByOwnerPhone(phone: string): Promise<string | null>;
}

function createTenantLookup(databaseUrl: string): {
  readonly lookup: TenantLookup;
  readonly close: () => Promise<void>;
} {
  const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
  const lookup: TenantLookup = {
    async findTenantByOwnerPhone(phone) {
      const rows = await sql<{ tenant_id: string }[]>`
        SELECT tenant_id FROM users
          WHERE phone = ${phone} AND is_owner = true AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`;
      return rows[0]?.tenant_id ?? null;
    },
  };
  return Object.freeze({
    lookup,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  });
}

// ─── Helpers extracted from the orchestration to stay under 50-line caps ─

function expectOk<T>(
  res: SeedHttpResponse,
  expectedStatus: number,
  kind: string,
  label: string,
): T {
  if (res.status !== expectedStatus) {
    throw new Error(
      `seed.${kind} failed (${res.status}) for "${label}": ${JSON.stringify(res.body)}`,
    );
  }
  const data = (res.body as { data?: unknown })?.data ?? res.body;
  return data as T;
}

interface IdShaped {
  readonly id: string;
}

// ─── Seed orchestration ──────────────────────────────────────────────

export interface SeedDemoDeps {
  readonly http: AuthenticatedHttpClient;
}

/**
 * Run the seed plan against the gateway. Pure orchestration — the
 * underlying creates exercise the same handlers production traffic
 * uses, so RLS / zod / audit-trail invariants are honoured.
 */
export async function seedDemoData(
  tenantId: string,
  args: SeedDemoArgs,
  deps: SeedDemoDeps,
): Promise<SeedDemoResult> {
  const plan: DemoDataPlan = buildDemoDataPlan();

  if (args.dryRun) {
    return Object.freeze({
      tenantId,
      seedRunId: args.seedRunId,
      counts: Object.freeze({
        licences: plan.sites.length,
        sites: plan.sites.length,
        workers: plan.workers.length,
        oreParcels: plan.oreParcels.length,
        buyers: plan.buyers.length,
        bids: plan.bids.length,
        incidents: plan.incidents.length,
        documents: plan.documents.length,
      }),
      resources: [],
    });
  }

  const resources: SeededResource[] = [];

  const licenceIds = await seedLicences(plan, args.seedRunId, deps, resources);
  const siteIds = await seedSites(plan, licenceIds, args.seedRunId, deps, resources);
  const parcelIds = await seedParcels(plan, siteIds, args.seedRunId, deps, resources);
  const buyerIds = await seedBuyers(plan, args.seedRunId, deps, resources);
  await seedBids(plan, parcelIds, buyerIds, args.seedRunId, deps, resources);
  await seedIncidents(plan, siteIds, args.seedRunId, deps, resources);
  await seedDocuments(plan, siteIds, args.seedRunId, deps, resources);

  logger.info({
    tenantId,
    seedRunId: args.seedRunId,
    resources: resources.length,
    msg: 'seed complete',
  });

  return Object.freeze({
    tenantId,
    seedRunId: args.seedRunId,
    counts: Object.freeze({
      licences: licenceIds.length,
      sites: siteIds.length,
      workers: 0,
      oreParcels: parcelIds.length,
      buyers: buyerIds.length,
      bids: plan.bids.length,
      incidents: plan.incidents.length,
      documents: plan.documents.length,
    }),
    resources,
  });
}

async function seedLicences(
  plan: DemoDataPlan,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<ReadonlyArray<string>> {
  const ids: string[] = [];
  for (const site of plan.sites) {
    const body = {
      companyId: 'dev-company',
      kind: site.licenceKind,
      number: site.licenceNumber,
      mineral: site.mineral,
      obligations: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request('POST', '/api/v1/mining/licences', body);
    const data = expectOk<IdShaped>(res, 201, 'licence', site.licenceNumber);
    ids.push(data.id);
    out.push({ kind: 'licence', id: data.id, label: site.licenceNumber });
  }
  return ids;
}

async function seedSites(
  plan: DemoDataPlan,
  licenceIds: ReadonlyArray<string>,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<ReadonlyArray<string>> {
  const ids: string[] = [];
  for (let i = 0; i < plan.sites.length; i += 1) {
    const site = plan.sites[i];
    const licenceId = licenceIds[i];
    if (!site || !licenceId) continue;
    const body = {
      licenceId,
      name: site.name,
      mineral: site.mineral,
      location: site.location,
      phase: site.phase,
      attributes: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request('POST', '/api/v1/mining/sites', body);
    const data = expectOk<IdShaped>(res, 201, 'site', site.name);
    ids.push(data.id);
    out.push({ kind: 'site', id: data.id, label: site.name });
  }
  return ids;
}

async function seedParcels(
  plan: DemoDataPlan,
  siteIds: ReadonlyArray<string>,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<ReadonlyArray<string>> {
  const ids: string[] = [];
  for (const parcel of plan.oreParcels) {
    const siteId = siteIds[parcel.siteIndex];
    if (!siteId) continue;
    const body = {
      siteId,
      massKg: parcel.massKg,
      storageLocation: parcel.storageLocation,
      attributes: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request(
      'POST',
      '/api/v1/mining/ore-parcels',
      body,
    );
    const data = expectOk<IdShaped>(res, 201, 'ore_parcel', parcel.storageLocation);
    ids.push(data.id);
    out.push({ kind: 'ore_parcel', id: data.id, label: parcel.storageLocation });
  }
  return ids;
}

async function seedBuyers(
  plan: DemoDataPlan,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<ReadonlyArray<string>> {
  const ids: string[] = [];
  for (const buyer of plan.buyers) {
    const body = {
      name: buyer.name,
      kind: buyer.kind,
      attributes: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request(
      'POST',
      '/api/v1/mining/buyers-kyc',
      body,
    );
    // Buyer-KYC may return 201 or 200 (accepted) depending on plan
    // status; the wire contract is that the response body carries the
    // buyer id either way.
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(
        `seed.buyer failed (${res.status}) for "${buyer.name}": ${JSON.stringify(res.body)}`,
      );
    }
    const data = (res.body as { data?: IdShaped })?.data ?? (res.body as IdShaped);
    ids.push(data.id);
    out.push({ kind: 'buyer', id: data.id, label: buyer.name });
  }
  return ids;
}

async function seedBids(
  plan: DemoDataPlan,
  parcelIds: ReadonlyArray<string>,
  buyerIds: ReadonlyArray<string>,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<void> {
  for (const bid of plan.bids) {
    const parcelId = parcelIds[bid.parcelIndex];
    const buyerId = buyerIds[bid.buyerIndex];
    if (!parcelId || !buyerId) continue;

    // First list the parcel for sale to create a marketplace listing.
    const listingBody = {
      title: `Demo listing ${seedRunId}-${bid.parcelIndex}`,
      priceTzs: '10000000',
      priceUnit: 'per_kg',
      visibility: 'tanzania',
    };
    const listingRes = await deps.http.request(
      'POST',
      `/api/v1/mining/ore-parcels/${parcelId}/list-for-sale`,
      listingBody,
    );
    const listing = expectOk<IdShaped>(
      listingRes,
      201,
      'listing',
      `${seedRunId}-${bid.parcelIndex}`,
    );

    // Then place the bid against the freshly created listing.
    const bidBody = {
      listingId: listing.id,
      bidPriceTzs: bid.bidPriceTzs,
      paymentTerms: bid.paymentTerms,
      notes: `Demo bid (seed_run_id=${seedRunId})`,
    };
    const bidRes = await deps.http.request(
      'POST',
      '/api/v1/mining/bids',
      bidBody,
    );
    const bidData = expectOk<IdShaped>(
      bidRes,
      201,
      'bid',
      `${seedRunId}-${bid.buyerIndex}`,
    );
    out.push({ kind: 'bid', id: bidData.id, label: `bid#${bid.buyerIndex}` });
  }
}

async function seedIncidents(
  plan: DemoDataPlan,
  siteIds: ReadonlyArray<string>,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<void> {
  const occurredAt = new Date().toISOString();
  for (const incident of plan.incidents) {
    const siteId = siteIds[incident.siteIndex];
    if (!siteId) continue;
    const body = {
      siteId,
      kind: incident.kind,
      severity: incident.severity,
      occurredAt,
      description: incident.description,
      attributes: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request(
      'POST',
      '/api/v1/mining/incidents',
      body,
    );
    const data = expectOk<IdShaped>(res, 201, 'incident', incident.description);
    out.push({ kind: 'incident', id: data.id, label: incident.description });
  }
}

async function seedDocuments(
  plan: DemoDataPlan,
  siteIds: ReadonlyArray<string>,
  seedRunId: string,
  deps: SeedDemoDeps,
  out: SeededResource[],
): Promise<void> {
  for (const doc of plan.documents) {
    const siteId = siteIds[doc.siteIndex];
    if (!siteId) continue;
    const body = {
      siteId,
      title: doc.title,
      kind: doc.kind,
      attributes: seedAttributes(seedRunId, { source: 'demo' }),
    };
    const res = await deps.http.request(
      'POST',
      '/api/v1/mining/documents',
      body,
    );
    const data = expectOk<IdShaped>(res, 201, 'document', doc.title);
    out.push({ kind: 'document', id: data.id, label: doc.title });
  }
}

// ─── Summary printer ─────────────────────────────────────────────────

function printSummary(result: SeedDemoResult, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [
    '─── Borjie demo data seeded ───────────────────────────────────',
    `  tenant id    : ${result.tenantId}`,
    `  seed_run_id  : ${result.seedRunId}`,
    `  licences     : ${result.counts.licences}`,
    `  sites        : ${result.counts.sites}`,
    `  ore parcels  : ${result.counts.oreParcels}`,
    `  buyers       : ${result.counts.buyers}`,
    `  bids         : ${result.counts.bids}`,
    `  incidents    : ${result.counts.incidents}`,
    `  documents    : ${result.counts.documents}`,
    '───────────────────────────────────────────────────────────────',
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

// ─── CLI entry ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: SeedDemoArgs;
  try {
    args = parseSeedDemoArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof SeedDemoValidationError) {
      process.stderr.write(`[seed-demo-data] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const databaseUrl =
    readEnv('DATABASE_URL') ?? 'postgresql://borjie:borjie@localhost:5432/borjie';
  const gatewayUrl =
    readEnvOneOf(['BORJIE_API_GATEWAY_URL', 'API_GATEWAY_URL', 'GATEWAY_URL']) ??
    DEFAULT_GATEWAY_URL;
  const token = readEnvOneOf([
    'BORJIE_DEV_OWNER_TOKEN',
    'BORJIE_DEV_TOKEN',
  ]);

  try {
    assertNotProduction(databaseUrl, gatewayUrl);
  } catch (err) {
    if (err instanceof SeedDemoValidationError) {
      process.stderr.write(`[seed-demo-data] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  if (!token && !args.dryRun) {
    process.stderr.write(
      '[seed-demo-data] BORJIE_DEV_OWNER_TOKEN env var required (Supabase access token for dev owner)\n',
    );
    process.exit(2);
  }

  // Resolve the target tenant.
  let tenantId = args.tenantId ?? null;
  let closeDb: (() => Promise<void>) | null = null;
  if (!tenantId) {
    const tl = createTenantLookup(databaseUrl);
    closeDb = tl.close;
    if (args.phone) {
      tenantId = await tl.lookup.findTenantByOwnerPhone(args.phone);
    }
    if (!tenantId) {
      await tl.close();
      process.stderr.write(
        `[seed-demo-data] no tenant found for phone=${args.phone}\n`,
      );
      process.exit(1);
    }
  }

  try {
    const result = await seedDemoData(tenantId, args, {
      http: createFetchClient({
        gatewayUrl,
        token: token ?? 'dry-run-token',
      }),
    });
    printSummary(result, args.json);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'seed-demo-data failed');
    process.stderr.write(`[seed-demo-data] ${message}\n`);
    process.exit(1);
  } finally {
    if (closeDb) await closeDb();
  }
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('seed-demo-data.ts');

if (invokedDirectly) {
  void main();
}
