/**
 * Cross-Reference Discovery — pure functions per entity_kind.
 *
 * Each discoverer joins a source row against its peers in the live
 * schema and returns the typed graph edges that the entity-indexer
 * worker upserts into `entity_cross_references`. Failures are
 * isolated: a single broken join cannot poison the whole discovery
 * pass — we return `[]` on any DB error and log via the caller.
 *
 * NOTE: every query uses parameterised `sql` literals so SQL injection
 * is structurally impossible. Tenant scoping is enforced both at the
 * SQL layer (WHERE clause) and at the RLS layer (api-gateway binds
 * `app.tenant_id` before every DB call).
 *
 * Mirrors the contract in Docs/DESIGN/ENTITY_LEGIBILITY_INDEX.md §4.
 */

import { sql } from 'drizzle-orm';
import type { Discoverer, DiscoveredEdge, DiscovererDb } from './types';

const FK_CONFIDENCE = 1.0;

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── Royalty drafts ──────────────────────────────────────────────────
// royalty_draft → parent licence (parent) + site (related) + regulator
// counterparty (related). The drafts table is the generic
// `document_drafts` registry filtered to kind='royalty'.
export const discoverForRoyaltyDraft: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT d.id::text                                                  AS draft_id,
             (d.payload ->> 'licenceId')                                 AS licence_id,
             (d.payload ->> 'siteId')                                    AS site_id,
             (d.payload ->> 'regulatorPartyId')                          AS regulator_id
        FROM document_drafts d
       WHERE d.tenant_id = ${tenantId}
         AND d.id::text  = ${sourceId}
         AND d.kind      = 'royalty'
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const licenceId = strOrNull(row.licence_id);
    if (licenceId) {
      edges.push({
        tenantId,
        sourceKind: 'royalty_draft',
        sourceId,
        targetKind: 'licence',
        targetId: licenceId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForRoyaltyDraft',
      });
    }
    const siteId = strOrNull(row.site_id);
    if (siteId) {
      edges.push({
        tenantId,
        sourceKind: 'royalty_draft',
        sourceId,
        targetKind: 'site',
        targetId: siteId,
        relationship: 'related',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForRoyaltyDraft',
      });
    }
    const regulatorId = strOrNull(row.regulator_id);
    if (regulatorId) {
      edges.push({
        tenantId,
        sourceKind: 'royalty_draft',
        sourceId,
        targetKind: 'counterparty',
        targetId: regulatorId,
        relationship: 'related',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForRoyaltyDraft',
      });
    }
  } catch {
    return [];
  }
  return edges;
};

// ─── Licences ─────────────────────────────────────────────────────────
// licence → company (parent) + holder user (related) + child sites.
export const discoverForLicence: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT l.company_id, l.holder_user_id
        FROM licences l
       WHERE l.tenant_id = ${tenantId}
         AND l.id        = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (res) {
      const row = rowsOf(res)[0];
      if (row) {
        const companyId = strOrNull(row.company_id);
        if (companyId) {
          edges.push({
            tenantId,
            sourceKind: 'licence',
            sourceId,
            targetKind: 'company',
            targetId: companyId,
            relationship: 'parent',
            confidence: FK_CONFIDENCE,
            derivationSource: 'discoverForLicence',
          });
        }
        const holderId = strOrNull(row.holder_user_id);
        if (holderId) {
          edges.push({
            tenantId,
            sourceKind: 'licence',
            sourceId,
            targetKind: 'employee',
            targetId: holderId,
            relationship: 'related',
            confidence: FK_CONFIDENCE,
            derivationSource: 'discoverForLicence',
          });
        }
      }
    }
    const childSites = await db.execute(sql`
      SELECT s.id
        FROM sites s
       WHERE s.tenant_id  = ${tenantId}
         AND s.licence_id = ${sourceId}
       LIMIT 50
    `).catch(() => null);
    if (childSites) {
      for (const row of rowsOf(childSites)) {
        const siteId = strOrNull(row.id);
        if (siteId) {
          edges.push({
            tenantId,
            sourceKind: 'licence',
            sourceId,
            targetKind: 'site',
            targetId: siteId,
            relationship: 'child',
            confidence: FK_CONFIDENCE,
            derivationSource: 'discoverForLicence',
          });
        }
      }
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Sites ───────────────────────────────────────────────────────────
// site → parent licence + manager (related).
export const discoverForSite: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT s.licence_id, s.manager_user_id
        FROM sites s
       WHERE s.tenant_id = ${tenantId}
         AND s.id        = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const licenceId = strOrNull(row.licence_id);
    if (licenceId) {
      edges.push({
        tenantId,
        sourceKind: 'site',
        sourceId,
        targetKind: 'licence',
        targetId: licenceId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForSite',
      });
    }
    const managerId = strOrNull(row.manager_user_id);
    if (managerId) {
      edges.push({
        tenantId,
        sourceKind: 'site',
        sourceId,
        targetKind: 'employee',
        targetId: managerId,
        relationship: 'related',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForSite',
      });
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Incidents ───────────────────────────────────────────────────────
// incident → site (parent) + affected employees (related).
export const discoverForIncident: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT i.site_id, i.affected_user_ids
        FROM incidents i
       WHERE i.tenant_id = ${tenantId}
         AND i.id        = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const siteId = strOrNull(row.site_id);
    if (siteId) {
      edges.push({
        tenantId,
        sourceKind: 'incident',
        sourceId,
        targetKind: 'site',
        targetId: siteId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForIncident',
      });
    }
    const affected = Array.isArray(row.affected_user_ids)
      ? (row.affected_user_ids as unknown[])
      : [];
    for (const uid of affected) {
      const employeeId = strOrNull(uid);
      if (employeeId) {
        edges.push({
          tenantId,
          sourceKind: 'incident',
          sourceId,
          targetKind: 'employee',
          targetId: employeeId,
          relationship: 'related',
          confidence: FK_CONFIDENCE,
          derivationSource: 'discoverForIncident',
        });
      }
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Reminders ───────────────────────────────────────────────────────
// reminder → entity referenced (related, via payload.entityRef).
export const discoverForReminder: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT (r.payload -> 'entityRef' ->> 'kind') AS ref_kind,
             (r.payload -> 'entityRef' ->> 'id')   AS ref_id
        FROM reminders r
       WHERE r.tenant_id = ${tenantId}
         AND r.id::text  = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const refKind = strOrNull(row.ref_kind);
    const refId = strOrNull(row.ref_id);
    if (refKind && refId) {
      edges.push({
        tenantId,
        sourceKind: 'reminder',
        sourceId,
        targetKind: refKind,
        targetId: refId,
        relationship: 'related',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForReminder',
      });
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Drill holes ─────────────────────────────────────────────────────
// drill_hole → site (parent).
export const discoverForDrillHole: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT d.site_id
        FROM drill_holes d
       WHERE d.tenant_id = ${tenantId}
         AND d.id::text  = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const siteId = strOrNull(row.site_id);
    if (siteId) {
      edges.push({
        tenantId,
        sourceKind: 'drill_hole',
        sourceId,
        targetKind: 'site',
        targetId: siteId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForDrillHole',
      });
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Parcels (mineral chain of custody origins) ──────────────────────
// parcel → site of origin (related) + first chain step (child).
export const discoverForParcel: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT m.id::text       AS step_id,
             m.to_party_id    AS buyer_id
        FROM mineral_chain_of_custody m
       WHERE m.tenant_id = ${tenantId}
         AND m.parcel_id = ${sourceId}
       ORDER BY m.step_index ASC
       LIMIT 50
    `).catch(() => null);
    if (!res) return [];
    for (const row of rowsOf(res)) {
      const stepId = strOrNull(row.step_id);
      if (stepId) {
        edges.push({
          tenantId,
          sourceKind: 'parcel',
          sourceId,
          targetKind: 'chain_of_custody_step',
          targetId: stepId,
          relationship: 'child',
          confidence: FK_CONFIDENCE,
          derivationSource: 'discoverForParcel',
        });
      }
      const buyerId = strOrNull(row.buyer_id);
      if (buyerId) {
        edges.push({
          tenantId,
          sourceKind: 'parcel',
          sourceId,
          targetKind: 'counterparty',
          targetId: buyerId,
          relationship: 'related',
          confidence: FK_CONFIDENCE,
          derivationSource: 'discoverForParcel',
        });
      }
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Bids ────────────────────────────────────────────────────────────
// bid → parcel (parent) + buyer (related).
export const discoverForBid: Discoverer = async (db, { tenantId, sourceId }) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT b.parcel_id, b.buyer_party_id
        FROM marketplace_bids b
       WHERE b.tenant_id = ${tenantId}
         AND b.id::text  = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const parcelId = strOrNull(row.parcel_id);
    if (parcelId) {
      edges.push({
        tenantId,
        sourceKind: 'bid',
        sourceId,
        targetKind: 'parcel',
        targetId: parcelId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForBid',
      });
    }
    const buyerId = strOrNull(row.buyer_party_id);
    if (buyerId) {
      edges.push({
        tenantId,
        sourceKind: 'bid',
        sourceId,
        targetKind: 'counterparty',
        targetId: buyerId,
        relationship: 'related',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForBid',
      });
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Workforce certifications ────────────────────────────────────────
// workforce_certification → employee (parent).
export const discoverForCertification: Discoverer = async (
  db,
  { tenantId, sourceId },
) => {
  const edges: DiscoveredEdge[] = [];
  try {
    const res = await db.execute(sql`
      SELECT c.user_id
        FROM workforce_certifications c
       WHERE c.tenant_id = ${tenantId}
         AND c.id::text  = ${sourceId}
       LIMIT 1
    `).catch(() => null);
    if (!res) return [];
    const row = rowsOf(res)[0];
    if (!row) return edges;
    const employeeId = strOrNull(row.user_id);
    if (employeeId) {
      edges.push({
        tenantId,
        sourceKind: 'workforce_certification',
        sourceId,
        targetKind: 'employee',
        targetId: employeeId,
        relationship: 'parent',
        confidence: FK_CONFIDENCE,
        derivationSource: 'discoverForCertification',
      });
    }
  } catch {
    return edges;
  }
  return edges;
};

// ─── Registry ────────────────────────────────────────────────────────

/** Map of entity_kind → discoverer. Worker iterates over its known
 *  kinds and dispatches each upsert to the matching discoverer. Adding
 *  a new entity_kind is a one-line registry change here plus a new
 *  pure function above. */
export const DISCOVERERS: Readonly<Record<string, Discoverer>> = Object.freeze({
  royalty_draft: discoverForRoyaltyDraft,
  licence: discoverForLicence,
  site: discoverForSite,
  incident: discoverForIncident,
  reminder: discoverForReminder,
  drill_hole: discoverForDrillHole,
  parcel: discoverForParcel,
  bid: discoverForBid,
  workforce_certification: discoverForCertification,
});

/** Best-effort wrapper: returns `[]` if no discoverer is registered. */
export async function discoverEdges(
  db: DiscovererDb,
  args: { readonly tenantId: string; readonly kind: string; readonly id: string },
): Promise<ReadonlyArray<DiscoveredEdge>> {
  const fn = DISCOVERERS[args.kind];
  if (!fn) return [];
  return fn(db, { tenantId: args.tenantId, sourceId: args.id });
}
