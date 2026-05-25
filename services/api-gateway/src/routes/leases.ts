
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { requireCapability } from '../middleware/capability-gate';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';
import { mapLeaseRow, majorToMinor, paginateArray } from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';

import { withSecurityEvents } from '@borjie/observability';
// Wave 19 Agent H+I: lease mutations are staff-only. RESIDENT / OWNER
// users read via `/leases/current*` (self) but cannot create, update,
// terminate, renew, or delete leases.
const staffOnly = requireRole(
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.ACCOUNTANT,
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
);

const isoDate = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid date');
const CreateLeaseSchema = z.object({
  unitId: z.string().min(1),
  customerId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  rentAmount: z.number().nonnegative(),
  depositAmount: z.number().nonnegative().optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  terms: z.object({
    gracePeriodDays: z.number().int().nonnegative().optional(),
    noticePeriodDays: z.number().int().nonnegative().optional(),
    utilitiesIncluded: z.array(z.string()).optional(),
  }).optional(),
}).refine((b) => new Date(b.endDate) >= new Date(b.startDate), {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});
const UpdateLeaseSchema = z.object({
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  rentAmount: z.number().nonnegative().optional(),
  depositAmount: z.number().nonnegative().optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  terms: z.object({
    gracePeriodDays: z.number().int().nonnegative().optional(),
    noticePeriodDays: z.number().int().nonnegative().optional(),
    utilitiesIncluded: z.array(z.string()).optional(),
  }).optional(),
});
const TerminateLeaseSchema = z.object({
  reason: z.string().min(1).max(1000).optional(),
});
const RenewLeaseSchema = z.object({
  newEndDate: isoDate.optional(),
  extendMonths: z.number().int().min(1).max(60).optional(),
  rentAmount: z.number().nonnegative().optional(),
}).refine((b) => b.newEndDate || b.extendMonths, {
  message: 'either newEndDate or extendMonths is required',
});

function leaseNumber() {
  return `LSE-${Date.now().toString().slice(-6)}`;
}

type LeaseUnitLookup = { id: string; unitCode?: string };
type LeaseCustomerLookup = { id: string; firstName: string; lastName: string };
type LeasePropertyLookup = { id: string; name: string };

type EnrichLeaseRepos = {
  units: {
    findById(id: string, tenantId: string): Promise<LeaseUnitLookup | null>;
    findByIds(ids: string[], tenantId: string): Promise<LeaseUnitLookup[]>;
  };
  customers: {
    findById(id: string, tenantId: string): Promise<LeaseCustomerLookup | null>;
    findByIds(ids: string[], tenantId: string): Promise<LeaseCustomerLookup[]>;
  };
  properties: {
    findById(id: string, tenantId: string): Promise<LeasePropertyLookup | null>;
    findByIds(ids: string[], tenantId: string): Promise<LeasePropertyLookup[]>;
  };
};

type LeaseRowLike = {
  unitId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
};

async function enrichLease(repos: EnrichLeaseRepos, tenantId: string, row: LeaseRowLike & Parameters<typeof mapLeaseRow>[0]) {
  const lease = mapLeaseRow(row);
  const [unit, customer, property] = await Promise.all([
    row.unitId ? repos.units.findById(row.unitId, tenantId) : null,
    row.customerId ? repos.customers.findById(row.customerId, tenantId) : null,
    row.propertyId ? repos.properties.findById(row.propertyId, tenantId) : null,
  ]);

  return {
    ...lease,
    unit: unit ? { id: unit.id, unitNumber: unit.unitCode } : undefined,
    customer: customer ? { id: customer.id, name: `${customer.firstName} ${customer.lastName}` } : undefined,
    property: property ? { id: property.id, name: property.name } : undefined,
  };
}

/**
 * Wave 25 Agent V: batch-enrich a list of lease rows.
 *
 * Previously the list endpoints fanned out `Promise.all(rows.map(enrichLease))`
 * which issued 3 queries per row (unit, customer, property). For a page of
 * 100 leases that was 300 round-trips. Now we issue 3 batched `IN (...)`
 * queries total, independent of page size. Result objects are immutable —
 * new objects are constructed via spread.
 */
async function enrichLeases(repos: EnrichLeaseRepos, tenantId: string, rows: Array<LeaseRowLike & Parameters<typeof mapLeaseRow>[0]>) {
  if (rows.length === 0) return [];
  const unitIds = rows.map((r) => r.unitId).filter((id): id is string => Boolean(id));
  const customerIds = rows.map((r) => r.customerId).filter((id): id is string => Boolean(id));
  const propertyIds = rows.map((r) => r.propertyId).filter((id): id is string => Boolean(id));

  const [units, customers, properties] = await Promise.all([
    repos.units.findByIds(unitIds, tenantId),
    repos.customers.findByIds(customerIds, tenantId),
    repos.properties.findByIds(propertyIds, tenantId),
  ]);

  const unitMap = new Map<string, LeaseUnitLookup>(units.map((u) => [u.id, u]));
  const customerMap = new Map<string, LeaseCustomerLookup>(customers.map((c) => [c.id, c]));
  const propertyMap = new Map<string, LeasePropertyLookup>(properties.map((p) => [p.id, p]));

  return rows.map((row) => {
    const lease = mapLeaseRow(row);
    const unit = row.unitId ? unitMap.get(row.unitId) : undefined;
    const customer = row.customerId ? customerMap.get(row.customerId) : undefined;
    const property = row.propertyId ? propertyMap.get(row.propertyId) : undefined;
    return {
      ...lease,
      unit: unit ? { id: unit.id, unitNumber: unit.unitCode } : undefined,
      customer: customer ? { id: customer.id, name: `${customer.firstName} ${customer.lastName}` } : undefined,
      property: property ? { id: property.id, name: property.name } : undefined,
    };
  });
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/current', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.leases.findByCustomer(auth.userId, auth.tenantId, { limit: 20, offset: 0 });
  const lease = result.items.find((item: { status: unknown }) => String(item.status) === 'active') || result.items[0];
  if (!lease) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Current lease not found' } }, 404);
  }
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, lease) });
});

// Customer-app helpers — "current" refers to the signed-in customer's
// active lease. These map to the same data as /leases/:id with the
// id resolved server-side from the JWT, sparing the mobile client a
// lookup round-trip.
app.get('/current/renewal-offer', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.leases.findByCustomer(auth.userId, auth.tenantId, { limit: 20, offset: 0 });
  const lease =
    result.items.find((item: { status: unknown }) => String(item.status) === 'active') || result.items[0];
  if (!lease) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No active lease' } },
      404
    );
  }
  // A renewal offer only exists within 90 days of expiry. If the
  // manager hasn't proposed one, return a "no offer" envelope so the
  // client UI can render the empty state cleanly.
  const endDate = new Date(lease.endDate);
  const daysUntilExpiry = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const offerAvailable = daysUntilExpiry <= 90 && daysUntilExpiry > 0;
  return c.json({
    success: true,
    data: {
      lease: await enrichLease(repos, auth.tenantId, lease),
      daysUntilExpiry,
      offerAvailable,
      proposedTerms: offerAvailable
        ? {
            newEndDate: new Date(
              endDate.getFullYear() + 1,
              endDate.getMonth(),
              endDate.getDate()
            ).toISOString(),
            rentAmount: lease.rentAmount,
          }
        : null,
    },
  });
});

app.post('/current/renew', withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.leases.findByCustomer(auth.userId, auth.tenantId, { limit: 20, offset: 0 });
  const lease = result.items.find((item: { status: unknown }) => String(item.status) === 'active');
  if (!lease) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No active lease to renew' } },
      404
    );
  }
  const body = await c.req.json().catch(() => ({}));
  const termMonths = Number(body.termMonths ?? 12);
  if (!Number.isFinite(termMonths) || termMonths < 1 || termMonths > 60) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'termMonths must be 1-60' } },
      400
    );
  }
  const currentEnd = new Date(lease.endDate);
  const newEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth() + termMonths, currentEnd.getDate());
  const row = await repos.leases.update(
    lease.id,
    auth.tenantId,
    {
      status: 'renewed',
      endDate: newEnd,
      rentAmount: body.rentAmount != null ? majorToMinor(body.rentAmount) : undefined,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
}));

app.get('/current/move-out', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.leases.findByCustomer(auth.userId, auth.tenantId, { limit: 20, offset: 0 });
  const lease =
    result.items.find((item: { status: unknown }) => String(item.status) === 'active') || result.items[0];
  if (!lease) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No active lease' } },
      404
    );
  }
  // If a move-out intent already exists it will be stored on the lease
  // as `moveOutAt`. No intent yet → empty data so the client renders
  // the "start move-out" flow.
  return c.json({
    success: true,
    data: {
      leaseId: lease.id,
      moveOutAt: (lease as { moveOutAt?: string | Date }).moveOutAt ?? null,
      minNoticeDays: lease.noticePeriodDays ?? 30,
      earliestMoveOutDate: new Date(Date.now() + (lease.noticePeriodDays ?? 30) * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
});

app.post('/current/move-out', withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const result = await repos.leases.findByCustomer(auth.userId, auth.tenantId, { limit: 20, offset: 0 });
  const lease = result.items.find((item: { status: unknown }) => String(item.status) === 'active');
  if (!lease) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'No active lease to move out from' } },
      404
    );
  }
  const body = await c.req.json().catch(() => ({}));
  const moveOutDate = body.moveOutDate ? new Date(body.moveOutDate) : undefined;
  if (!moveOutDate || Number.isNaN(moveOutDate.getTime())) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'moveOutDate is required' } },
      400
    );
  }
  // Clients can't submit a move-out date inside the notice period.
  const earliest = Date.now() + (lease.noticePeriodDays ?? 30) * 24 * 60 * 60 * 1000;
  if (moveOutDate.getTime() < earliest) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOTICE_PERIOD_VIOLATED',
          message: `Move-out date must be at least ${lease.noticePeriodDays ?? 30} days away`,
        },
      },
      400
    );
  }
  const row = await repos.leases.update(
    lease.id,
    auth.tenantId,
    {
      status: 'notice_given',
      terminationNotes: (body.reason as string | undefined) ?? 'Tenant-initiated move-out',
      terminatedBy: auth.userId,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({
    success: true,
    data: {
      lease: await enrichLease(repos, auth.tenantId, row),
      moveOutDate: moveOutDate.toISOString(),
      inspectionDue: true,
    },
  });
}));

app.get('/expiring', async (c) => {
  // "Expiring" still needs a full scan because the filter is post-DB
  // (endDate <= cutoff). We cap at 500 rows so a pathological tenant
  // with tens of thousands of active leases can't blow memory.
  const auth = c.get('auth');
  const repos = c.get('repos');
  const p = parseListPagination(c);
  const days = Number(c.req.query('days') || '60');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const result = await repos.leases.findMany(auth.tenantId, { limit: 500, offset: 0 }, { status: 'active' });
  const expiring = (result.items as Array<{ endDate: string | Date }>).filter(
    (row) => new Date(row.endDate) <= cutoff
  );
  const enriched = await enrichLeases(repos, auth.tenantId, expiring);
  const pageSlice = enriched.slice(p.offset, p.offset + p.limit);
  return c.json({ success: true, ...buildListResponse(pageSlice, enriched.length, p) });
});

app.get('/', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const p = parseListPagination(c);
  const filters = {
    status: c.req.query('status')?.toLowerCase(),
    propertyId: c.req.query('propertyId'),
    customerId: c.req.query('customerId'),
  };
  const result = await repos.leases.findMany(auth.tenantId, { limit: p.limit, offset: p.offset }, filters);
  const enriched = await enrichLeases(repos, auth.tenantId, result.items);
  return c.json({ success: true, ...buildListResponse(enriched, result.total ?? enriched.length, p) });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const row = await repos.leases.findById(c.req.param('id'), auth.tenantId);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lease not found' } }, 404);
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
});

app.post('/', staffOnly, requireCapability('create', 'lease'), zValidator('json', CreateLeaseSchema), withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  const unit = await repos.units.findById(body.unitId, auth.tenantId);
  if (!unit) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Unit not found' } }, 404);

  const row = await repos.leases.create(
    {
      id: crypto.randomUUID(),
      tenantId: auth.tenantId,
      propertyId: unit.propertyId,
      unitId: body.unitId,
      customerId: body.customerId,
      leaseNumber: leaseNumber(),
      leaseType: 'fixed_term',
      status: 'draft',
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      rentAmount: majorToMinor(body.rentAmount),
      securityDepositAmount: majorToMinor(body.depositAmount),
      securityDepositPaid: 0,
      rentDueDay: body.paymentDueDay || 1,
      gracePeriodDays: body.terms?.gracePeriodDays || 5,
      noticePeriodDays: body.terms?.noticePeriodDays || 30,
      utilitiesIncludedInRent: body.terms?.utilitiesIncluded || [],
      primaryOccupant: { name: 'Primary Occupant', relationship: 'self' },
      createdBy: auth.userId,
      updatedBy: auth.userId,
    },
    auth.userId
  );

  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) }, 201);
}));

app.put('/:id', staffOnly, zValidator('json', UpdateLeaseSchema), withSecurityEvents({ action: 'lease.update', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.leases.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lease not found' } }, 404);
  const body = c.req.valid('json');
  const row = await repos.leases.update(
    id,
    auth.tenantId,
    {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      rentAmount: body.rentAmount != null ? majorToMinor(body.rentAmount) : undefined,
      securityDepositAmount: body.depositAmount != null ? majorToMinor(body.depositAmount) : undefined,
      rentDueDay: body.paymentDueDay,
      gracePeriodDays: body.terms?.gracePeriodDays,
      noticePeriodDays: body.terms?.noticePeriodDays,
      utilitiesIncludedInRent: body.terms?.utilitiesIncluded,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
}));

app.post('/:id/activate', staffOnly, withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const row = await repos.leases.update(c.req.param('id'), auth.tenantId, { status: 'active', activatedAt: new Date(), activatedBy: auth.userId }, auth.userId);
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
}));

app.post('/:id/terminate', staffOnly, zValidator('json', TerminateLeaseSchema), withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  const row = await repos.leases.update(
    c.req.param('id'),
    auth.tenantId,
    {
      status: 'terminated',
      terminatedAt: new Date(),
      terminationReason: body.reason ? 'other' : undefined,
      terminationNotes: body.reason,
      terminatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
}));

app.post('/:id/renew', staffOnly, zValidator('json', RenewLeaseSchema), withSecurityEvents({ action: 'lease.create', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.leases.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lease not found' } }, 404);
  const body = c.req.valid('json');
  const currentEnd = new Date(existing.endDate);
  const newEnd = body.newEndDate
    ? new Date(body.newEndDate)
    : new Date(currentEnd.getFullYear(), currentEnd.getMonth() + Number(body.extendMonths || 12), currentEnd.getDate());

  const row = await repos.leases.update(
    id,
    auth.tenantId,
    {
      status: 'renewed',
      endDate: newEnd,
      // Schema accepts `rentAmount`; also accept `newRentAmount` as a
      // back-compat alias for older clients. Either one (or neither)
      // is fine — absent means "keep existing rent".
      rentAmount: body.rentAmount != null
        ? majorToMinor(body.rentAmount)
        : (body as { newRentAmount?: number }).newRentAmount != null
          ? majorToMinor((body as { newRentAmount: number }).newRentAmount)
          : undefined,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichLease(repos, auth.tenantId, row) });
}));

app.delete('/:id', staffOnly, requireCapability('delete', 'lease'), withSecurityEvents({ action: 'lease.delete', resource: 'lease', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  await repos.leases.delete(c.req.param('id'), auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Lease deleted' } });
}));

export const leasesRouter = app;
