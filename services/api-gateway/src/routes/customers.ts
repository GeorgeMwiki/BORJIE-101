
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';
import { mapCustomerRow, mapUnitRow, paginateArray } from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';

/**
 * Bug fix A-BUG-DEEP #12: concurrency-limited Promise.all.
 *
 * The previous `Promise.all(rows.map(enrichCustomer))` opened one
 * database round-trip per row simultaneously. For a 50-row page that
 * means 50 parallel queries — enough to exhaust the postgres connection
 * pool on a busy gateway and cause cascading 5xx. Cap concurrency at 16
 * so each list call uses at most 16 connections concurrently regardless
 * of page size. Inlined to avoid adding a new dependency to
 * package.json + pnpm-lock.yaml in this audit pass.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function pump(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current]!, current);
    }
  }
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => pump());
  await Promise.all(lanes);
  return results;
}

// Wave 19 Agent H+I: customer CRUD on arbitrary customers is a landlord
// operation. Self-service endpoints (`/me`, `/me/PUT`) use JWT `userId`
// and remain open for residents to edit their own profile.
const staffOnly = requireRole(
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.ACCOUNTANT,
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
);

const phoneSchema = z.string().min(6).max(24).regex(/^[+0-9 \-()]+$/, 'invalid phone');
const CustomerCreateSchema = z.object({
  email: z.string().email().max(255).optional(),
  phone: phoneSchema.optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
}).refine((b) => b.email || b.phone, {
  message: 'email or phone is required',
});
const CustomerUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: phoneSchema.optional(),
  alternatePhone: phoneSchema.optional(),
  status: z.string().optional(),
  kycStatus: z.string().optional(),
  verificationStatus: z.string().optional(),
  preferredContactMethod: z.enum(['email', 'sms', 'whatsapp', 'phone']).optional(),
  avatarUrl: z.string().url().optional(),
});

function customerCode(email: string) {
  return `CUST-${(email.split('@')[0] ?? email).replace(/[^A-Z0-9]+/gi, '').slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
}

type CustomerRowLike = { id: string };
type LeaseLike = {
  id: string;
  status: string;
  startDate?: unknown;
  endDate?: unknown;
  rentAmount?: unknown;
  unitId?: string | null;
};
type EnrichCustomerRepos = {
  leases: { findByCustomer(customerId: string, tenantId: string, p: { limit: number; offset: number }): Promise<{ items: LeaseLike[] }> };
  units: { findById(id: string, tenantId: string): Promise<Parameters<typeof mapUnitRow>[0] | null> };
};

async function enrichCustomer(repos: EnrichCustomerRepos, tenantId: string, row: CustomerRowLike & Parameters<typeof mapCustomerRow>[0]) {
  const base = mapCustomerRow(row);
  const leases = await repos.leases.findByCustomer(row.id, tenantId, { limit: 20, offset: 0 });
  const activeLease = leases.items.find((lease) => String(lease.status) === 'active');
  let currentUnit: ReturnType<typeof mapUnitRow> | null = null;
  if (activeLease?.unitId) {
    const unit = await repos.units.findById(activeLease.unitId, tenantId);
    if (unit) currentUnit = mapUnitRow(unit);
  }

  return {
    ...base,
    currentLease: activeLease
      ? {
          id: activeLease.id,
          status: String(activeLease.status).toUpperCase(),
          startDate: activeLease.startDate,
          endDate: activeLease.endDate,
          rentAmount: activeLease.rentAmount,
          unitId: activeLease.unitId,
        }
      : null,
    currentUnit:
      currentUnit && {
        id: currentUnit.id,
        unitNumber: currentUnit.unitNumber,
        propertyId: currentUnit.propertyId,
      },
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/me', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const row = await repos.customers.findById(auth.userId, auth.tenantId);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer profile not found' } }, 404);
  }
  return c.json({ success: true, data: await enrichCustomer(repos, auth.tenantId, row) });
});

app.put('/me', zValidator('json', CustomerUpdateSchema), async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const existing = await repos.customers.findById(auth.userId, auth.tenantId);
  if (!existing) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer profile not found' } }, 404);
  }
  const body = c.req.valid('json');
  const row = await repos.customers.update(
    auth.userId,
    auth.tenantId,
    {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email?.trim().toLowerCase(),
      phone: body.phone,
      alternatePhone: body.alternatePhone,
      preferredContactMethod: body.preferredContactMethod,
      avatarUrl: body.avatarUrl,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichCustomer(repos, auth.tenantId, row) });
});

app.get('/', staffOnly, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const p = parseListPagination(c);
  const search = c.req.query('search');
  const status = c.req.query('status');

  const result = await repos.customers.findMany(
    auth.tenantId,
    { limit: p.limit, offset: p.offset },
    { search, status: status?.toLowerCase() }
  );
  const enriched = await mapWithConcurrency(
    result.items as Array<CustomerRowLike & Parameters<typeof mapCustomerRow>[0]>,
    16,
    (row) => enrichCustomer(repos, auth.tenantId, row),
  );
  return c.json({ success: true, ...buildListResponse(enriched, result.total ?? enriched.length, p) });
});

app.get('/:id', staffOnly, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const row = await repos.customers.findById(c.req.param('id'), auth.tenantId);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  return c.json({ success: true, data: await enrichCustomer(repos, auth.tenantId, row) });
});

app.post('/', staffOnly, zValidator('json', CustomerCreateSchema), async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = c.req.valid('json');
  const row = await repos.customers.create(
    {
      id: crypto.randomUUID(),
      tenantId: auth.tenantId,
      customerCode: customerCode(body.email || body.phone || 'customer'),
      email: body.email?.trim().toLowerCase(),
      phone: body.phone,
      firstName: body.firstName,
      lastName: body.lastName,
      status: 'active',
      kycStatus: 'pending',
      createdBy: auth.userId,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichCustomer(repos, auth.tenantId, row) }, 201);
});

app.put('/:id', staffOnly, zValidator('json', CustomerUpdateSchema), async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  const existing = await repos.customers.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  const body = c.req.valid('json');
  const row = await repos.customers.update(
    id,
    auth.tenantId,
    {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email?.trim().toLowerCase(),
      phone: body.phone,
      alternatePhone: body.alternatePhone,
      status: body.status?.toLowerCase(),
      kycStatus: body.verificationStatus?.toLowerCase(),
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: await enrichCustomer(repos, auth.tenantId, row) });
});

app.delete('/:id', staffOnly, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  await repos.customers.delete(id, auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Customer deleted' } });
});

export const customersRouter = app;
