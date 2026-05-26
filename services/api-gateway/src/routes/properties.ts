
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { requireCapability } from '../middleware/capability-gate';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';
import type { AuthContext } from './hono-auth';
import {
  mapPropertyRow,
  mapUnitRow,
  normalizePropertyStatusToDb,
  normalizePropertyTypeToDb,
  paginateArray,
} from './db-mappers';
import { parseListPagination, buildListResponse } from './pagination';

import { withSecurityEvents } from '@borjie/observability';
// Wave 19 Agent H+I: property create/update/delete are staff-only.
// Read endpoints already filter via `hasPropertyAccess` (JWT ACL).
const staffOnly = requireRole(
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
);

// Country accepts either ISO-3166 alpha-2 codes ("KE", "TZ") OR the
// full country name — the mobile UI submits either, depending on which
// dropdown the user last touched. Normalization to a code happens in
// the persistence layer.
const AddressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().min(2).max(100).optional(),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
}).partial();
const PropertyCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
  address: AddressSchema.optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string().url()).optional(),
  settings: z.record(z.unknown()).optional(),
  managerId: z.string().optional(),
  totalUnits: z.number().int().nonnegative().optional(),
  occupiedUnits: z.number().int().nonnegative().optional(),
});
const PropertyUpdateSchema = PropertyCreateSchema.partial();

function hasPropertyAccess(auth: Pick<AuthContext, 'propertyAccess'>, propertyId: string) {
  return auth.propertyAccess?.includes('*') || auth.propertyAccess?.includes(propertyId);
}

function propertyCode(name: string) {
  return `PROP-${name.replace(/[^A-Z0-9]+/gi, '').slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  // Filters (search/status/type/city) are pushed into
  // repos.properties.findManyFiltered so the DB honours them via
  // parameterized WHERE + ILIKE clauses. Tenant isolation is enforced
  // inside the repo; propertyAccess ACL is applied post-fetch because
  // it comes from the JWT, not the DB row.
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const p = parseListPagination(c);
  const search = c.req.query('search') || undefined;
  const status = c.req.query('status') || undefined;
  const type = c.req.query('type') || undefined;
  const city = c.req.query('city') || undefined;

  const wildcardAccess = auth.propertyAccess?.includes('*');
  const allowedIds =
    wildcardAccess || !Array.isArray(auth.propertyAccess)
      ? undefined
      : (auth.propertyAccess as readonly string[]);

  const result = await repos.properties.findManyFiltered(
    auth.tenantId,
    { search, status, type, city, allowedIds },
    { limit: p.limit, offset: p.offset }
  );

  const items = result.items.map(mapPropertyRow);
  return c.json({
    success: true,
    ...buildListResponse(items, result.total, p),
  });
});

app.get('/:id/units', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  if (!hasPropertyAccess(auth, id)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }

  const p = parseListPagination(c);
  const status = c.req.query('status');
  // Status filter is in-memory; push it into repos.units.findByProperty
  // when the repo gains a filters param.
  const result = await repos.units.findByProperty(id, auth.tenantId, { limit: 500, offset: 0 });
  let items = result.items.map(mapUnitRow);
  if (status) items = items.filter((item) => item.status === status);
  const pageSlice = items.slice(p.offset, p.offset + p.limit);
  return c.json({ success: true, ...buildListResponse(pageSlice, items.length, p) });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  if (!hasPropertyAccess(auth, id)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }

  const row = await repos.properties.findById(id, auth.tenantId);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Property not found' } }, 404);
  }

  return c.json({ success: true, data: mapPropertyRow(row) });
});

app.post('/', staffOnly, requireCapability('create', 'property'), zValidator('json', PropertyCreateSchema), withSecurityEvents({ action: 'property.create', resource: 'property', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = c.req.valid('json');

  const row = await repos.properties.create(
    {
      id: crypto.randomUUID(),
      tenantId: auth.tenantId,
      ownerId: auth.userId,
      propertyCode: propertyCode(body.name || 'PROPERTY'),
      name: body.name,
      type: normalizePropertyTypeToDb(body.type),
      status: normalizePropertyStatusToDb(body.status),
      description: body.description,
      addressLine1: body.address?.line1,
      addressLine2: body.address?.line2,
      city: body.address?.city,
      state: body.address?.region,
      postalCode: body.address?.postalCode,
      country: body.address?.country || 'KE',
      latitude: body.address?.coordinates?.latitude?.toString(),
      longitude: body.address?.coordinates?.longitude?.toString(),
      amenities: body.amenities || [],
      images: body.images || [],
      features: body.settings || {},
      managerId: body.managerId,
      totalUnits: body.totalUnits || 0,
      occupiedUnits: body.occupiedUnits || 0,
      vacantUnits: Math.max((body.totalUnits || 0) - (body.occupiedUnits || 0), 0),
      createdBy: auth.userId,
      updatedBy: auth.userId,
    },
    auth.userId
  );

  return c.json({ success: true, data: mapPropertyRow(row) }, 201);
}));

app.put('/:id', staffOnly, zValidator('json', PropertyUpdateSchema), withSecurityEvents({ action: 'property.update', resource: 'property', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  if (!hasPropertyAccess(auth, id)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }

  const body = c.req.valid('json');
  const row = await repos.properties.update(
    id,
    auth.tenantId,
    {
      name: body.name,
      type: body.type ? normalizePropertyTypeToDb(body.type) : undefined,
      status: body.status ? normalizePropertyStatusToDb(body.status) : undefined,
      description: body.description,
      addressLine1: body.address?.line1,
      addressLine2: body.address?.line2,
      city: body.address?.city,
      state: body.address?.region,
      postalCode: body.address?.postalCode,
      country: body.address?.country,
      latitude: body.address?.coordinates?.latitude?.toString(),
      longitude: body.address?.coordinates?.longitude?.toString(),
      amenities: body.amenities,
      images: body.images,
      features: body.settings,
      managerId: body.managerId,
      totalUnits: body.totalUnits,
      occupiedUnits: body.occupiedUnits,
      vacantUnits:
        body.totalUnits != null || body.occupiedUnits != null
          ? Math.max((body.totalUnits ?? 0) - (body.occupiedUnits ?? 0), 0)
          : undefined,
      updatedBy: auth.userId,
    },
    auth.userId
  );

  return c.json({ success: true, data: mapPropertyRow(row) });
}));

app.delete('/:id', staffOnly, requireCapability('delete', 'property'), withSecurityEvents({ action: 'property.delete', resource: 'property', severity: 'notice' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const id = c.req.param('id');
  if (!hasPropertyAccess(auth, id)) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient property access' } }, 403);
  }
  await repos.properties.delete(id, auth.tenantId, auth.userId);
  return c.json({ success: true, data: { message: 'Property deleted' } });
}));

export const propertiesRouter = app;
