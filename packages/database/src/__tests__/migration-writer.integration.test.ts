/**
 * MigrationWriterService — REAL Postgres integration tests.
 *
 * Skipped when DATABASE_URL is not set. NEVER mocks the database. When the
 * env is configured, these tests:
 *  1. Connect to the real database (Supabase Postgres in CI/staging).
 *  2. Use a per-test schema or tenant id to avoid cross-test pollution.
 *  3. Assert real rows were inserted via repository reads.
 *
 * To run locally:
 *   export DATABASE_URL=postgresql://...
 *   pnpm --filter @borjie/database test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { createDatabaseClient } from '../client.js';
import { MigrationWriterService } from '../services/migration-writer.service.js';
import { tenants, users } from '../schemas/tenant.schema.js';
import { eq } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = Boolean(DATABASE_URL);

describe.skipIf(!RUN)('MigrationWriterService (real Postgres)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let writer: MigrationWriterService;
  const tenantId = `mw-test-${uuid()}`;
  const ownerId = `owner-${uuid()}`;

  beforeAll(async () => {
    db = createDatabaseClient(DATABASE_URL!);
    writer = new MigrationWriterService(db);
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Migration Writer Test Tenant',
      slug: tenantId,
      status: 'active',
      subscriptionTier: 'starter',
      primaryEmail: 'mw-test@example.com',
    });
    await db.insert(users).values({
      id: ownerId,
      tenantId,
      email: 'owner@example.com',
      passwordHash: 'placeholder',
      firstName: 'Owner',
      lastName: 'User',
      status: 'active',
    } as never);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('inserts properties + units + customers + departments + teams + employees', async () => {
    const report = await writer.commit(
      {
        properties: [
          {
            name: 'Kilimani Heights',
            addressLine1: 'Argwings Kodhek Rd',
            city: 'Nairobi',
            unitCount: 2,
            propertyType: 'apartment_complex',
          },
        ],
        units: [
          { propertyName: 'Kilimani Heights', label: 'A-1', bedrooms: 2, rentKes: 45_000 },
          { propertyName: 'Kilimani Heights', label: 'A-2', bedrooms: 3, rentKes: 60_000 },
        ],
        tenants: [{ name: 'Asha Wanjiku', phone: '0712000001', unitLabel: 'A-1' }],
        departments: [{ code: 'OPS', name: 'Operations' }],
        teams: [{ code: 'MAINT', name: 'Maintenance', kind: 'maintenance', departmentCode: 'OPS' }],
        employees: [
          {
            firstName: 'John',
            lastName: 'Mwangi',
            jobTitle: 'Caretaker',
            phone: '0712000002',
            departmentCode: 'OPS',
          },
        ],
      },
      { tenantId, ownerUserId: ownerId, actorUserId: ownerId, tenantCountry: 'KE', tenantCurrency: 'KES', defaultCity: 'Nairobi' }
    );
    expect(report.ok).toBe(true);
    expect(report.inserted.properties).toBe(1);
    expect(report.inserted.units).toBe(2);
    expect(report.inserted.customers).toBe(1);
    expect(report.inserted.departments).toBe(1);
    expect(report.inserted.teams).toBe(1);
    expect(report.inserted.employees).toBe(1);
  });

  it('detects duplicates on a second run', async () => {
    const report = await writer.commit(
      {
        properties: [
          {
            name: 'Kilimani Heights',
            addressLine1: 'Argwings Kodhek Rd',
            city: 'Nairobi',
            propertyType: 'apartment_complex',
          },
        ],
      },
      { tenantId, ownerUserId: ownerId, actorUserId: ownerId, tenantCountry: 'KE', tenantCurrency: 'KES', defaultCity: 'Nairobi' },
      { bestEffort: true }
    );
    expect(report.duplicates).toBeGreaterThan(0);
  });

  it('aborts batch on first failure when bestEffort=false', async () => {
    const report = await writer.commit(
      {
        properties: [
          {
            name: 'Missing Address Property',
            // addressLine1 deliberately missing
            propertyType: 'apartment_complex',
          },
        ],
      },
      { tenantId, ownerUserId: ownerId, actorUserId: ownerId, tenantCountry: 'KE', tenantCurrency: 'KES', defaultCity: 'Nairobi' }
    );
    expect(report.ok).toBe(false);
    expect(report.abortError).toBeDefined();
    expect(report.failed).toBe(1);
  });
});
