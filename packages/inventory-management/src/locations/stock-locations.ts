/**
 * Stock-location hierarchy.
 *
 * Locations form a tree: warehouse > zone > rack > bin. Properties +
 * units are themselves locations (`kind: 'property' | 'unit'`) so the
 * same movement engine handles "install fridge in unit U-409" without
 * a special path.
 *
 * Pure functions over a `ReadonlyArray<StockLocation>` collection.
 */

import { z } from 'zod';
import {
  err,
  LOCATION_KINDS,
  ok,
  type LocationId,
  type LocationKind,
  type Result,
  type StockLocation,
  type TenantId,
} from '../types.js';

const LocationKindSchema = z.enum(LOCATION_KINDS);

export const LocationDraftSchema = z.object({
  name: z.string().min(1).max(160),
  kind: LocationKindSchema,
  parentLocationId: z.string().nullable(),
  address: z.string().max(500).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  managerUserId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
});

export type LocationDraft = z.infer<typeof LocationDraftSchema>;

export function createLocation(
  existing: ReadonlyArray<StockLocation>,
  tenantId: TenantId,
  draft: LocationDraft,
  idGen: () => LocationId,
): Result<{ readonly location: StockLocation; readonly tree: ReadonlyArray<StockLocation> }, 'BAD_REQUEST' | 'PARENT_NOT_FOUND' | 'TENANT_MISMATCH'> {
  const parsed = LocationDraftSchema.safeParse(draft);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  if (parsed.data.parentLocationId) {
    const parent = existing.find((l) => l.id === parsed.data.parentLocationId);
    if (!parent) return err('PARENT_NOT_FOUND', `parent location ${parsed.data.parentLocationId} not found`);
    if (parent.tenantId !== tenantId) return err('TENANT_MISMATCH', 'parent belongs to another tenant');
  }
  const location: StockLocation = {
    id: idGen(),
    tenantId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    parentLocationId: parsed.data.parentLocationId,
    ...(parsed.data.address !== undefined && { address: parsed.data.address }),
    ...(parsed.data.geoLat !== undefined && { geoLat: parsed.data.geoLat }),
    ...(parsed.data.geoLng !== undefined && { geoLng: parsed.data.geoLng }),
    ...(parsed.data.managerUserId !== undefined && { managerUserId: parsed.data.managerUserId }),
    ...(parsed.data.propertyId !== undefined && { propertyId: parsed.data.propertyId }),
    ...(parsed.data.unitId !== undefined && { unitId: parsed.data.unitId }),
  };
  return ok({ location, tree: [...existing, location] });
}

export function findLocation(
  tree: ReadonlyArray<StockLocation>,
  tenantId: TenantId,
  locationId: LocationId,
): StockLocation | null {
  const l = tree.find((x) => x.id === locationId);
  if (!l || l.tenantId !== tenantId) return null;
  return l;
}

export function listLocations(
  tree: ReadonlyArray<StockLocation>,
  tenantId: TenantId,
  filter?: { readonly kind?: LocationKind; readonly parentLocationId?: LocationId | null },
): ReadonlyArray<StockLocation> {
  return tree.filter((l) => {
    if (l.tenantId !== tenantId) return false;
    if (l.archivedAt) return false;
    if (filter?.kind && l.kind !== filter.kind) return false;
    if (filter?.parentLocationId !== undefined && l.parentLocationId !== filter.parentLocationId) return false;
    return true;
  });
}

/**
 * Resolve the chain from the given location up to the root warehouse.
 * Useful when computing "show me all stock under warehouse-A" — caller
 * gathers descendants via `descendantsOf`.
 */
export function ancestorsOf(
  tree: ReadonlyArray<StockLocation>,
  locationId: LocationId,
): ReadonlyArray<StockLocation> {
  const map = new Map(tree.map((l) => [l.id, l]));
  const out: StockLocation[] = [];
  let cur = map.get(locationId);
  const seen = new Set<string>();
  while (cur && cur.parentLocationId) {
    if (seen.has(cur.id)) break; // defensive — cycle
    seen.add(cur.id);
    const parent = map.get(cur.parentLocationId);
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

export function descendantsOf(
  tree: ReadonlyArray<StockLocation>,
  locationId: LocationId,
): ReadonlyArray<StockLocation> {
  const childMap = new Map<string, StockLocation[]>();
  for (const l of tree) {
    if (l.parentLocationId) {
      const list = childMap.get(l.parentLocationId) ?? [];
      list.push(l);
      childMap.set(l.parentLocationId, list);
    }
  }
  const out: StockLocation[] = [];
  const walk = (id: string) => {
    const kids = childMap.get(id) ?? [];
    for (const k of kids) {
      out.push(k);
      walk(k.id);
    }
  };
  walk(locationId);
  return out;
}

export interface LocationNode {
  readonly location: StockLocation;
  readonly children: ReadonlyArray<LocationNode>;
}

export function buildLocationTree(
  tree: ReadonlyArray<StockLocation>,
  tenantId: TenantId,
): ReadonlyArray<LocationNode> {
  const scoped = tree.filter((l) => l.tenantId === tenantId && !l.archivedAt);
  const childMap = new Map<string | null, StockLocation[]>();
  for (const l of scoped) {
    const key = l.parentLocationId;
    const list = childMap.get(key) ?? [];
    list.push(l);
    childMap.set(key, list);
  }
  const build = (parent: string | null): ReadonlyArray<LocationNode> => {
    const kids = childMap.get(parent) ?? [];
    return kids.map((l) => ({ location: l, children: build(l.id) }));
  };
  return build(null);
}

/**
 * Every property has a default stock location for installed items.
 * Lookup helper that finds-or-creates the property's `kind:'property'`
 * location row. Returns the existing one when present.
 */
export function defaultPropertyLocation(
  tree: ReadonlyArray<StockLocation>,
  tenantId: TenantId,
  propertyId: string,
  idGen: () => LocationId,
): { readonly location: StockLocation; readonly tree: ReadonlyArray<StockLocation> } {
  const existing = tree.find(
    (l) => l.tenantId === tenantId && l.kind === 'property' && l.propertyId === propertyId,
  );
  if (existing) return { location: existing, tree };
  const location: StockLocation = {
    id: idGen(),
    tenantId,
    name: `Property ${propertyId}`,
    kind: 'property',
    parentLocationId: null,
    propertyId,
  };
  return { location, tree: [...tree, location] };
}
