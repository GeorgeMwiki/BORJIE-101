/**
 * Seed Demo Data for Owner Cockpit
 *
 * Idempotent demo-data seeder. Populates all 9 tables:
 * - companies + sites (FK chain)
 * - 4 mining licences
 * - 8 workers
 * - 3 incidents
 * - 2 ore parcels
 * - 3 FX hedges
 * - 2 documents
 * - 2 reminders
 *
 * Usage: DATABASE_URL=... TENANT_ID=... pnpm seed:owner-demo
 */

import { createDatabaseClient } from '../packages/database/src/client.js';
import { eq, and } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import {
  companies,
  sites,
  licences,
  employees,
  incidents,
  oreParcels,
  fxRates,
  documentUploads,
  reminders,
} from '../packages/database/src/schemas/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID = process.env.TENANT_ID;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}
if (!TENANT_ID) {
  throw new Error('TENANT_ID not set (pass as env var)');
}

const db = createDatabaseClient(DATABASE_URL);
const DEMO_NAMESPACE = 'e69c00a4-64f0-5f78-93fd-35aa02c78c06';

function deterministicId(prefix: string, seed: string): string {
  return `${prefix}-${uuidv5(seed, DEMO_NAMESPACE).substring(0, 12)}`;
}

function getRandomPastDate(daysAgo: number): Date {
  const now = new Date();
  const random = Math.floor(Math.random() * daysAgo);
  const date = new Date(now);
  date.setDate(date.getDate() - random);
  return date;
}

function getFutureDate(daysFromNow: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date;
}

async function seedDemoData() {
  console.log('\n🌱 Starting Owner Demo Data Seed...\n');
  console.log(`✓ Using tenant: ${TENANT_ID}`);

  try {
    const companyId = deterministicId('company', `${TENANT_ID}:geita-gold-holdings`);
    const companyResults = await seedCompanies(db, TENANT_ID, companyId);
    const siteIds = await seedSites(db, TENANT_ID, companyId);
    const geitaSiteId = siteIds[0];
    const licenceResults = await seedLicences(db, TENANT_ID, companyId);
    const workerResults = await seedWorkers(db, TENANT_ID, companyId, geitaSiteId);
    const incidentResults = await seedIncidents(db, TENANT_ID, geitaSiteId);
    const parcelResults = await seedOreParcels(db, TENANT_ID, geitaSiteId);
    const fxResults = await seedFxRates();
    const docResults = await seedDocuments(db, TENANT_ID);
    const reminderResults = await seedReminders(db, TENANT_ID);

    printSummary(
      companyResults,
      { count: siteIds.length, skipped: 0 },
      licenceResults,
      workerResults,
      incidentResults,
      parcelResults,
      fxResults,
      docResults,
      reminderResults
    );

    console.log('\n✅ Seed completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }
}

async function seedCompanies(db: any, tenantId: string, companyId: string) {
  try {
    const exists = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.tenantId, tenantId),
          eq(companies.id, companyId)
        )
      )
      .limit(1);

    if (!exists || exists.length === 0) {
      await db.insert(companies).values({
        id: companyId,
        tenantId,
        name: 'Geita Gold Holdings Ltd',
        registrationNo: 'BRELA-2023-001',
        country: 'TZ',
        attributes: {},
        createdAt: new Date(),
      });
      return { count: 1, skipped: 0 };
    }
    return { count: 0, skipped: 1 };
  } catch (err) {
    console.warn(`  ⚠ Company upsert skipped:`, (err as Error).message);
    return { count: 0, skipped: 1 };
  }
}

async function seedSites(db: any, tenantId: string, companyId: string) {
  const siteData = [
    { id: deterministicId('site', `${tenantId}:geita-pml`), name: 'Geita PML', mineral: 'Au', licenceId: 'PML/001/2024' },
    { id: deterministicId('site', `${tenantId}:mererani-pit`), name: 'Mererani Pit', mineral: 'tanzanite', licenceId: 'PML/003/2024' },
    { id: deterministicId('site', `${tenantId}:songwe-field`), name: 'Songwe Field', mineral: 'Au+Cu', licenceId: 'PML/002/2024' },
  ];

  const siteIds: string[] = [];
  for (const site of siteData) {
    try {
      const exists = await db.select().from(sites).where(and(eq(sites.tenantId, tenantId), eq(sites.id, site.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(sites).values({
          id: site.id,
          tenantId,
          licenceId: site.licenceId,
          name: site.name,
          mineral: site.mineral,
          phase: 'extraction',
          status: 'active',
          geologyConfidence: '0.75',
          attributes: {},
          createdAt: getRandomPastDate(90),
        });
      }
      siteIds.push(site.id);
    } catch (err) {
      console.warn(`  ⚠ Site ${site.id} upsert skipped:`, (err as Error).message);
    }
  }
  return siteIds;
}

async function seedLicences(db: any, tenantId: string, companyId: string) {
  const licences_data = [
    { id: 'PML/001/2024', kind: 'PML', number: '001/2024', mineral: 'Au', expiryDate: getFutureDate(23), areaHa: '45.5' },
    { id: 'PML/002/2024', kind: 'PML', number: '002/2024', mineral: 'Au+Cu', expiryDate: getFutureDate(89), areaHa: '78.2' },
    { id: 'PML/003/2024', kind: 'PML', number: '003/2024', mineral: 'tanzanite', expiryDate: getFutureDate(247), areaHa: '32.1' },
    { id: 'ML/001/2024', kind: 'ML', number: '001/2024', mineral: 'Au', expiryDate: getFutureDate(412), areaHa: '120.0' },
  ];

  let inserted = 0;
  for (const lic of licences_data) {
    try {
      const exists = await db.select().from(licences).where(and(eq(licences.tenantId, tenantId), eq(licences.id, lic.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(licences).values({
          id: lic.id,
          tenantId,
          companyId,
          kind: lic.kind,
          number: lic.number,
          mineral: lic.mineral,
          expiryDate: lic.expiryDate.toISOString().split('T')[0],
          areaHa: lic.areaHa,
          status: 'active',
          fees: { annual_fee_tzs: 500000, royalty_rate_pct: 6.0 },
          obligations: { eia_required: true, community_benefit: true },
          dormancyScore: 0,
          createdAt: getRandomPastDate(90),
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Licence ${lic.id} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: licences_data.length - inserted };
}

async function seedWorkers(db: any, tenantId: string, companyId: string, siteId: string) {
  const workers_data = [
    { id: 'EMP-SVR-001', fullName: 'Joseph Mwakibinga', role: 'Pit Supervisor', employmentType: 'PML_employee', wageBasis: 'daily', wageRateTzs: '75000', nidaId: 'TZ-NID-001-2020' },
    { id: 'EMP-SVR-002', fullName: 'Amina Hassan', role: 'Equipment Supervisor', employmentType: 'PML_employee', wageBasis: 'monthly', wageRateTzs: '2500000', nidaId: 'TZ-NID-002-2021' },
    { id: 'EMP-SVR-003', fullName: 'Emmanuel Kiprotich', role: 'Safety Coordinator', employmentType: 'PML_employee', wageBasis: 'monthly', wageRateTzs: '2200000', nidaId: null },
    { id: 'EMP-SVR-004', fullName: 'Lucia Banda', role: 'Site Manager', employmentType: 'PML_employee', wageBasis: 'monthly', wageRateTzs: '3000000', nidaId: 'TZ-NID-004-2019' },
    { id: 'EMP-PIT-001', fullName: 'Peter Kamau', role: 'Pit Operator', employmentType: 'PML_employee', wageBasis: 'daily', wageRateTzs: '65000', nidaId: 'TZ-NID-005-2022' },
    { id: 'EMP-PIT-002', fullName: 'David Musyoka', role: 'Pit Operator', employmentType: 'casual', wageBasis: 'daily', wageRateTzs: '55000', nidaId: null },
    { id: 'EMP-PIT-003', fullName: 'Grace Mwangi', role: 'Pit Operator', employmentType: 'PML_employee', wageBasis: 'daily', wageRateTzs: '65000', nidaId: 'TZ-NID-006-2021' },
    { id: 'EMP-PIT-004', fullName: 'Samuel Osei', role: 'Pit Operator', employmentType: 'contractor', wageBasis: 'production_share', wageRateTzs: '0', nidaId: 'TZ-NID-007-2023' },
  ];

  let inserted = 0;
  for (const worker of workers_data) {
    try {
      const exists = await db.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, worker.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(employees).values({
          id: worker.id,
          tenantId,
          companyId,
          siteId,
          fullName: worker.fullName,
          nidaId: worker.nidaId,
          role: worker.role,
          employmentType: worker.employmentType,
          wageBasis: worker.wageBasis,
          wageRateTzs: worker.wageRateTzs,
          nationality: 'TZ',
          status: 'active',
          startDate: getRandomPastDate(365).toISOString().split('T')[0],
          attributes: { ica_certificate: ['EMP-SVR-002', 'EMP-PIT-003'].includes(worker.id) },
          createdAt: getRandomPastDate(90),
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Employee ${worker.id} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: workers_data.length - inserted };
}

async function seedIncidents(db: any, tenantId: string, siteId: string) {
  const incidents_data = [
    { id: 'INC-001-2026', kind: 'safety', severity: 'medium', occurredAt: getRandomPastDate(30), description: 'Minor laceration during equipment maintenance', status: 'closed', closedAt: getRandomPastDate(20) },
    { id: 'INC-002-2026', kind: 'equipment_failure', severity: 'high', occurredAt: getRandomPastDate(45), description: 'Excavator hydraulic leak, 6 hours downtime', status: 'closed', closedAt: getRandomPastDate(35) },
    { id: 'INC-003-2026', kind: 'near_miss', severity: 'low', occurredAt: getRandomPastDate(10), description: 'Near-miss: stone fall in pit, no injuries', status: 'open', closedAt: null },
  ];

  let inserted = 0;
  for (const inc of incidents_data) {
    try {
      const exists = await db.select().from(incidents).where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, inc.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(incidents).values({
          id: inc.id,
          tenantId,
          siteId,
          kind: inc.kind,
          severity: inc.severity,
          occurredAt: inc.occurredAt,
          description: inc.description,
          status: inc.status,
          closedAt: inc.closedAt,
          affectedUserIds: [],
          fatalities: 0,
          injuries: inc.kind === 'safety' ? 1 : 0,
          correctiveActions: [],
          createdAt: getRandomPastDate(90),
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Incident ${inc.id} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: incidents_data.length - inserted };
}

async function seedOreParcels(db: any, tenantId: string, siteId: string) {
  const parcels_data = [
    { id: 'PARCEL-001-2026', massKg: '7200', mineral: 'Au', grade: 'LBMA', description: 'Gold dore-bar, LBMA grade', status: 'in_stockpile' },
    { id: 'PARCEL-002-2026', massKg: '480', mineral: 'tanzanite', grade: 'ICA B+', description: 'Tanzanite rough, ICA grade B+', status: 'in_stockpile' },
  ];

  let inserted = 0;
  for (const parcel of parcels_data) {
    try {
      const exists = await db.select().from(oreParcels).where(and(eq(oreParcels.tenantId, tenantId), eq(oreParcels.id, parcel.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(oreParcels).values({
          id: parcel.id,
          tenantId,
          siteId,
          massKg: parcel.massKg,
          grade: { mineral: parcel.mineral, grade: parcel.grade },
          storageLocation: 'Warehouse A',
          status: parcel.status,
          attributes: { description: parcel.description },
          createdAt: getRandomPastDate(60),
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Ore parcel ${parcel.id} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: parcels_data.length - inserted };
}

async function seedFxRates() {
  const fx_data = [
    { pair: 'TZS_USD', rate: '2450.75', daysAgo: 5 },
    { pair: 'TZS_USD', rate: '2448.30', daysAgo: 15 },
    { pair: 'TZS_USD', rate: '2451.10', daysAgo: 25 },
  ];

  let inserted = 0;
  for (const fx of fx_data) {
    try {
      const ts = getRandomPastDate(parseInt(fx.daysAgo));
      await db.insert(fxRates).values({
        id: `fx-${fx.pair}-${ts.getTime()}`,
        pair: fx.pair,
        rate: fx.rate,
        source: 'BoT',
        ts,
      });
      inserted++;
    } catch (err) {
      if (!(err as Error).message.includes('duplicate')) {
        console.warn(`  ⚠ FX rate insert skipped:`, (err as Error).message);
      }
    }
  }
  return { count: inserted, skipped: fx_data.length - inserted };
}

async function seedDocuments(db: any, tenantId: string) {
  const docs_data = [
    { id: 'DOC-NEMC-EIA-001', fileName: 'NEMC_EIA_Decision_2024.pdf', documentType: 'notice' },
    { id: 'DOC-BRELA-CERT-001', fileName: 'BRELA_Certificate_2024.pdf', documentType: 'notice' },
  ];

  let inserted = 0;
  for (const doc of docs_data) {
    try {
      const exists = await db.select().from(documentUploads).where(and(eq(documentUploads.tenantId, tenantId), eq(documentUploads.id, doc.id))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(documentUploads).values({
          id: doc.id,
          tenantId,
          documentType: doc.documentType,
          status: 'validated',
          source: 'manual',
          fileName: doc.fileName,
          fileSize: 1024000,
          mimeType: 'application/pdf',
          fileUrl: `s3://borjie-docs/${doc.fileName}`,
          metadata: { category: 'Regulatory', summary: doc.fileName },
          createdAt: getRandomPastDate(60),
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Document ${doc.id} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: docs_data.length - inserted };
}

async function seedReminders(db: any, tenantId: string) {
  const reminders_data = [
    { title: 'Royalty Filing Due', body: 'Monthly royalty filing to Mining Commission is due in 12 days.', triggerAt: getFutureDate(12), idempotencyKey: `${tenantId}-royalty-filing-${new Date().getMonth()}` },
    { title: 'NEMC EIA Refresh Required', body: 'Environmental Impact Assessment review refresh is due in 47 days.', triggerAt: getFutureDate(47), idempotencyKey: `${tenantId}-nemc-eia-refresh-${new Date().getMonth()}` },
  ];

  let inserted = 0;
  for (const rem of reminders_data) {
    try {
      const exists = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.idempotencyKey, rem.idempotencyKey))).limit(1);
      if (!exists || exists.length === 0) {
        await db.insert(reminders).values({
          tenantId,
          ownerId: tenantId,
          title: rem.title,
          body: rem.body,
          triggerAt: rem.triggerAt,
          channel: 'email',
          status: 'scheduled',
          idempotencyKey: rem.idempotencyKey,
          payload: {},
        });
        inserted++;
      }
    } catch (err) {
      console.warn(`  ⚠ Reminder ${rem.idempotencyKey} upsert skipped:`, (err as Error).message);
    }
  }
  return { count: inserted, skipped: reminders_data.length - inserted };
}

function printSummary(companies: any, siteRes: any, licences: any, workers: any, incidents: any, parcels: any, fx: any, docs: any, reminders: any) {
  const summary = [
    { table: 'companies', inserted: companies.count, skipped: companies.skipped },
    { table: 'sites', inserted: siteRes.count, skipped: siteRes.skipped },
    { table: 'licences', inserted: licences.count, skipped: licences.skipped },
    { table: 'employees', inserted: workers.count, skipped: workers.skipped },
    { table: 'incidents', inserted: incidents.count, skipped: incidents.skipped },
    { table: 'ore_parcels', inserted: parcels.count, skipped: parcels.skipped },
    { table: 'fx_rates', inserted: fx.count, skipped: fx.skipped },
    { table: 'documents', inserted: docs.count, skipped: docs.skipped },
    { table: 'reminders', inserted: reminders.count, skipped: reminders.skipped },
  ];
  console.log('\n📊 Seed Summary:');
  console.table(summary);
  console.log('\n');
}

seedDemoData();
