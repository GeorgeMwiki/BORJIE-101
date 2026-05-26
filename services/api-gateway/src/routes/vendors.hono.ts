
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { mapVendorRow, paginateArray } from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';

import { withSecurityEvents } from '@borjie/observability';
const ContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(24).optional(),
  type: z.string().max(30).optional(),
});
const VendorBaseSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200).optional(),
  contactPerson: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(24).optional(),
  status: z.string().max(30).optional(),
  specializations: z.array(z.string()).optional(),
  serviceAreas: z.array(z.string()).optional(),
  contacts: z.array(ContactSchema).optional(),
  isPreferred: z.boolean().optional(),
  emergencyAvailable: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});
// On create we require either companyName or name — refine the base.
// On update both stay optional since partial-update callers omit
// identifying fields; server-side validators above enforce that
// unsetting both is rejected at the DB layer.
const VendorCreateSchema = VendorBaseSchema.refine(
  (b) => b.companyName || b.name,
  { message: 'companyName or name is required' }
);
const VendorUpdateSchema = VendorBaseSchema;

function vendorCode(name: string) {
  return `VEN-${name.replace(/[^A-Z0-9]+/gi, '').slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const p = parseListPagination(c);
  const status = c.req.query('status')?.toLowerCase();
  const specialization = c.req.query('specialization');
  // Filters are pushed into repos.vendors.findMany's DB-level WHERE
  // clause (status = $1, specializations @> $2::jsonb). Tenant
  // isolation is enforced by the repo.
  const result = await repos.vendors.findMany(
    auth.tenantId,
    p.limit,
    p.offset,
    { status, specialization }
  );
  const items = result.items.map(mapVendorRow);
  return c.json({
    success: true,
    ...buildListResponse(items, result.total, p),
  });
});

app.get('/available', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const category = c.req.query('category');
  const rows = category
    ? await repos.vendors.findAvailable(String(category).toLowerCase(), false, auth.tenantId)
    : await repos.vendors.findPreferred(auth.tenantId);
  return c.json({ success: true, data: rows.map(mapVendorRow) });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const row = await repos.vendors.findById(c.req.param('id'), auth.tenantId);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Vendor not found' } }, 404);
  return c.json({ success: true, data: mapVendorRow(row) });
});

app.post('/', zValidator('json', VendorCreateSchema), withSecurityEvents({ action: 'vendor.create', resource: 'vendor', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = c.req.valid('json');
  const row = await repos.vendors.create({
    id: crypto.randomUUID(),
    tenantId: auth.tenantId,
    vendorCode: vendorCode(body.companyName || body.name || 'vendor'),
    companyName: body.companyName || body.name,
    status: String(body.status || 'active').toLowerCase(),
    specializations: body.specializations || [],
    serviceAreas: body.serviceAreas || [],
    contacts: body.contacts || [{
      name: body.contactPerson,
      email: body.email,
      phone: body.phone,
      type: 'primary',
    }],
    isPreferred: Boolean(body.isPreferred),
    emergencyAvailable: Boolean(body.emergencyAvailable),
    notes: body.notes,
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  return c.json({ success: true, data: mapVendorRow(row) }, 201);
}));

app.put('/:id', zValidator('json', VendorUpdateSchema), withSecurityEvents({ action: 'vendor.update', resource: 'vendor', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = c.req.valid('json');
  const row = await repos.vendors.update(c.req.param('id'), auth.tenantId, {
    companyName: body.companyName || body.name,
    status: body.status ? String(body.status).toLowerCase() : undefined,
    specializations: body.specializations,
    serviceAreas: body.serviceAreas,
    contacts: body.contacts,
    isPreferred: body.isPreferred,
    emergencyAvailable: body.emergencyAvailable,
    notes: body.notes,
    updatedBy: auth.userId,
  });
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Vendor not found' } }, 404);
  return c.json({ success: true, data: mapVendorRow(row) });
}));

app.delete('/:id', withSecurityEvents({ action: 'vendor.delete', resource: 'vendor', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  await repos.vendors.delete(c.req.param('id'), auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Vendor deleted' } });
}));

export const vendorsRouter = app;
