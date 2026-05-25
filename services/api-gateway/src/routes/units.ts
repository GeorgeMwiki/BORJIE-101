
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';
import {
  mapUnitRow,
  normalizeUnitStatusToDb,
  normalizeUnitTypeToDb,
  paginateArray,
  majorToMinor,
} from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';
import type { AuthContext } from './hono-auth';

import { withSecurityEvents } from '@borjie/observability';
// Wave 19 Agent H+I: unit mutations are staff-only. Reads are still
// gated by `hasPropertyAccess` (JWT ACL).
const staffOnly = requireRole(
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
);

const UnitCreateSchema = z.object({
  propertyId: z.string().min(1),
  unitNumber: z.string().min(1).max(50),
  name: z.string().max(100).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  floor: z.number().int().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().nonnegative().optional(),
  squareMeters: z.number().nonnegative().optional(),
  rentAmount: z.number().nonnegative().optional(),
  depositAmount: z.number().nonnegative().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string().url()).optional(),
});
const UnitUpdateSchema = UnitCreateSchema.partial();
const UnitStatusSchema = z.object({ status: z.string().min(1) });

function hasPropertyAccess(auth: Pick<AuthContext, 'propertyAccess'>, propertyId: string) {
  return auth.propertyAccess?.includes('*') || auth.propertyAccess?.includes(propertyId);
}

/**
 * Minimal DB-row shape we touch before `mapUnitRow` normalizes it. The
 * repos port exposes rows as `unknown`, so we narrow structurally to the
 * fields we actually read here (propertyId for ACL filtering).
 */
type UnitRowLike = { propertyId: string };

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const p = parseListPagination(c);
  const propertyId = c.req.query('propertyId');
  const status = c.req.query('status');
  const search = (c.req.query('search') || '').toLowerCase();

  // status/search are in-memory filters; cap the fetch at 500.
  const result = propertyId
    ? await repos.units.findByProperty(propertyId, auth.tenantId, { limit: 500, offset: 0 })
    : await repos.units.findMany(auth.tenantId, { limit: 500, offset: 0 });

  let items = (result.items as UnitRowLike[])
    .filter((row) => hasPropertyAccess(auth, row.propertyId))
    .map(mapUnitRow);

  if (status) items = items.filter((item) => item.status === status);
  if (search) {
    items = items.filter((item) =>
      [item.unitNumber, item.name, item.type].some((v) => String(v || '').toLowerCase().includes(search))
    );
  }

  const pageSlice = items.slice(p.offset, p.offset + p.limit);
  return c.json({ success: true, ...buildListResponse(pageSlice, items.length, p) });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const row = await repos.units.findById(c.req.param('id'), auth.tenantId);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Unit not found' } }, 404);
  if (!hasPropertyAccess(auth, row.propertyId)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }
  return c.json({ success: true, data: mapUnitRow(row) });
});

app.post('/', staffOnly, zValidator('json', UnitCreateSchema), withSecurityEvents({ action: 'unit.create', resource: 'unit', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const body = c.req.valid('json');
  if (!hasPropertyAccess(auth, body.propertyId)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }

  const row = await repos.units.create(
    {
      id: crypto.randomUUID(),
      tenantId: auth.tenantId,
      propertyId: body.propertyId,
      unitCode: body.unitNumber,
      name: body.unitNumber,
      type: normalizeUnitTypeToDb(body.type),
      status: normalizeUnitStatusToDb(body.status),
      floor: body.floor,
      bedrooms: body.bedrooms,
      bathrooms: String(body.bathrooms ?? 0),
      squareMeters: body.squareMeters != null ? String(body.squareMeters) : undefined,
      baseRentAmount: majorToMinor(body.rentAmount),
      depositAmount: majorToMinor(body.depositAmount),
      amenities: body.amenities || [],
      images: body.images || [],
      createdBy: auth.userId,
      updatedBy: auth.userId,
    },
    auth.userId
  );

  return c.json({ success: true, data: mapUnitRow(row) }, 201);
}));

app.put('/:id', staffOnly, zValidator('json', UnitUpdateSchema), withSecurityEvents({ action: 'unit.update', resource: 'unit', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.units.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Unit not found' } }, 404);
  if (!hasPropertyAccess(auth, existing.propertyId)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }
  const body = c.req.valid('json');
  const row = await repos.units.update(
    id,
    auth.tenantId,
    {
      unitCode: body.unitNumber,
      name: body.name || body.unitNumber,
      type: body.type ? normalizeUnitTypeToDb(body.type) : undefined,
      status: body.status ? normalizeUnitStatusToDb(body.status) : undefined,
      floor: body.floor,
      bedrooms: body.bedrooms,
      bathrooms: body.bathrooms != null ? String(body.bathrooms) : undefined,
      squareMeters: body.squareMeters != null ? String(body.squareMeters) : undefined,
      baseRentAmount: body.rentAmount != null ? majorToMinor(body.rentAmount) : undefined,
      depositAmount: body.depositAmount != null ? majorToMinor(body.depositAmount) : undefined,
      amenities: body.amenities,
      images: body.images,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: mapUnitRow(row) });
}));

app.put('/:id/status', staffOnly, zValidator('json', UnitStatusSchema), withSecurityEvents({ action: 'unit.update', resource: 'unit', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.units.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Unit not found' } }, 404);
  const body = c.req.valid('json');
  const row = await repos.units.update(id, auth.tenantId, { status: normalizeUnitStatusToDb(body.status) }, auth.userId);
  return c.json({ success: true, data: mapUnitRow(row) });
}));

app.delete('/:id', staffOnly, withSecurityEvents({ action: 'unit.delete', resource: 'unit', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.units.findById(id, auth.tenantId);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Unit not found' } }, 404);
  await repos.units.delete(id, auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Unit deleted' } });
}));

export const unitsRouter = app;
