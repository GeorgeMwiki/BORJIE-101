// @ts-nocheck — drizzle 0.45 jsonb narrowing mirrors trc-test-org-seed.

/**
 * TRC questionnaire intelligence baseline (internal test data only).
 *
 * Ingests the verbatim 2026-04-18 interview transcript at
 * `Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md`
 * into TRC's test-tenant brain so the AI starts with a richly-configured
 * posture instead of a blank slate.
 *
 * Three durable surfaces are populated:
 *
 *   1. `kernel_memory_semantic` — extracted facts with confidence + key,
 *      one row per durable answer (e.g. "approval threshold = 500K TZS").
 *   2. `core_memory_blocks` — Letta-style persistent self-summary blocks
 *      (sub-kind = `project`) that frame TRC's posture for every prompt.
 *   3. `reflexion_lessons` — pre-canned operational lessons distilled
 *      from the questionnaire's pain points (Section 3, 6, 14 etc.) so
 *      the brain "already knows what hurts" before the first MD chat.
 *
 * Disclaimer (mirrors the questionnaire memo's product-neutrality note):
 *   This seed is INTERNAL test data only — `trc-*` ids are confined to
 *   the dev / test tenant. The productized fixture is "Demo Estate
 *   Corporation" with `demo-*` ids. Nothing here references the research
 *   client by name in customer-facing copy or product strings.
 *
 * Idempotency:
 *   - Every row uses a deterministic natural-key id (`trc-mem-*`,
 *     `trc-lesson-*`) and `onConflictDoNothing` against the unique
 *     index for that table. Re-running is a no-op.
 *
 * Invocation:
 *   Called from `seedTrcTestOrg(db)` after the base scaffold. The
 *   seed runner does NOT invoke this directly — operational data must
 *   still come from real-user MD-chat per the existing contract.
 */

import type { DatabaseClient } from '../client.js';
import {
  kernelMemorySemantic,
  coreMemoryBlocks,
  reflexionLessons,
} from '../schemas/index.js';
import { TRC_TENANT_ID } from './trc-test-org-seed.js';

// ---------------------------------------------------------------------------
// Persona id used for the TRC brain's persistent self-summary. Matches
// the convention demo-org-seed uses for `preferences` blocks. Test-only.
// ---------------------------------------------------------------------------

export const TRC_BRAIN_PERSONA_ID = 'trc-persona-md';

// ---------------------------------------------------------------------------
// Semantic memory facts — one row per durable TRC answer. The kernel
// retrieval layer (kernel-memory-semantic.service) reads these via
// `(tenant_id, user_id, key)` lookup; `user_id = null` makes them
// tenant-scoped (visible to every TRC user).
//
// Confidence is 0..1 — declared facts ride at 0.95 since the user
// stated them directly in the interview. Confidence < 1 leaves room
// for the consolidation cycle to mark a fact as superseded later
// without violating the schema's `real` column bound.
// ---------------------------------------------------------------------------

interface TrcSemanticFact {
  readonly idSuffix: string;
  readonly key: string;
  readonly text: string;
  readonly rationale: string;
  readonly confidence: number;
  /** Plain-text excerpt the operator can audit back against the memo. */
  readonly sectionRef: string;
}

const TRC_SEMANTIC_FACTS: readonly TrcSemanticFact[] = [
  // ── Section 1 — approvals --------------------------------------------------
  {
    idSuffix: 'approval-bareland-threshold',
    key: 'approval.bareland_dg_threshold_tzs',
    text:
      'Bareland leases at or above 500,000 TZS/month route to the Directorate of Civil Engineering & Infrastructure first, then to the Director General. Below 500,000 TZS stay department-level (EMU only, no DG).',
    rationale:
      'Captured from the questionnaire Section 1 approval-flow pseudocode; threshold is org-configurable.',
    confidence: 0.95,
    sectionRef: 'Section 1 — Approval flow',
  },
  {
    idSuffix: 'approval-developed-threshold',
    key: 'approval.developed_dg_threshold_tzs',
    text:
      'Developed-asset (warehouse, building) leases at or above 500,000 TZS/month route directly to the Director General. Below 500,000 TZS stay at EMU level.',
    rationale: 'Section 1 ELIF branch — developed assets skip the DCEI step.',
    confidence: 0.95,
    sectionRef: 'Section 1 — Approval flow',
  },
  {
    idSuffix: 'role-owner-mapping',
    key: 'roles.owner_mapping',
    text:
      'The Estate Management Unit (EMU) is modelled as the Owner account, even though the parent organisation legally owns the asset. EMU has full control; only EMU can delete the account.',
    rationale: 'Section 1 EMU mapping; same primitive applies to NHC and banks.',
    confidence: 0.95,
    sectionRef: 'Section 1 — Roles',
  },
  {
    idSuffix: 'role-super-admin-cap',
    key: 'roles.super_admin_cap',
    text:
      'Super Admin role is capped at 2 per organisation. Super Admins have Owner-equivalent power except cannot delete the account.',
    rationale: 'Section 1 — centralized role hierarchy.',
    confidence: 0.9,
    sectionRef: 'Section 1 — Roles',
  },
  {
    idSuffix: 'role-admin-levels',
    key: 'roles.admin_levels',
    text:
      'Admin role has 4 descending levels (Admin 1 → Admin 4) with decreasing control top-down. No hard cap on the number of admins per level.',
    rationale: 'Section 1 — admin tiering.',
    confidence: 0.85,
    sectionRef: 'Section 1 — Roles',
  },
  // ── Section 2 — property + geo --------------------------------------------
  {
    idSuffix: 'geo-hierarchy-labels',
    key: 'geo.hierarchy_labels',
    text:
      'Geo hierarchy is org-defined (NEVER force a fixed region->district->village structure). TRC uses: District > Region > Station > Asset. Districts contain Regions — note the inversion versus global convention.',
    rationale: 'Section 2 — elastic geo-hierarchy directive.',
    confidence: 0.95,
    sectionRef: 'Section 2 — Geo hierarchy',
  },
  {
    idSuffix: 'property-classes',
    key: 'property.classes_adopted',
    text:
      'Property classes adopted by TRC: commercial, mixed-use, villas, hotels, plots, warehouses, bareland. Each class has owner-selected sub-attributes (rooms, kitchens, bathrooms, furnishing level, appliances, fixtures, size).',
    rationale: 'Section 2 — property classification superset.',
    confidence: 0.9,
    sectionRef: 'Section 2 — Property classification',
  },
  {
    idSuffix: 'leasing-granularity',
    key: 'leasing.granularity',
    text:
      'Lease granularity is owner-controlled: whole plot, building, single room, or section of a floor are all valid. History nests infinitely: building -> unit -> customer -> contract -> payments -> documents -> maintenance events.',
    rationale: 'Section 2 — leasing flexibility + arbitrary subdivision.',
    confidence: 0.95,
    sectionRef: 'Section 2 — Leasing flexibility',
  },
  // ── Section 3 — registry + audit pains ------------------------------------
  {
    idSuffix: 'pain-double-leasing',
    key: 'pain.double_leasing_risk',
    text:
      'Double-leasing (same asset leased to two customers) is a top revenue-loss cause; auto-flag when a lease intersects an existing one on the same asset slice.',
    rationale: 'Section 3 — core pain points listed by TRC.',
    confidence: 0.95,
    sectionRef: 'Section 3 — Asset registry pain',
  },
  {
    idSuffix: 'pain-pricing-negotiation',
    key: 'pain.under_pricing_high_value',
    text:
      'High-value TRC assets are routinely under-leased due to poor pricing negotiations. The AI must surface comparable-rent benchmarks before any DG-tier negotiation.',
    rationale: 'Section 3 — pricing pain.',
    confidence: 0.9,
    sectionRef: 'Section 3 — Pricing pain',
  },
  // ── Section 4 — customer journey ------------------------------------------
  {
    idSuffix: 'tenant-app-universality',
    key: 'tenant.app_is_cross_org',
    text:
      'Tenants use ONE app across many organisations; tenancy with TRC is bootstrapped by a special invite code issued by EMU, never by a TRC-siloed download.',
    rationale: 'Section 4 — universal tenant identity.',
    confidence: 0.95,
    sectionRef: 'Section 4 — Customer journey',
  },
  // ── Section 6 — payments --------------------------------------------------
  {
    idSuffix: 'payment-rail',
    key: 'payment.rail_primary',
    text:
      'Primary payment rail for TRC is GePG (Tanzanian government e-payment gateway) control-number flow. Reconciliation must run against GePG callback receipts, not just internal ledger.',
    rationale: 'Section 6 — GePG integration mandate.',
    confidence: 0.95,
    sectionRef: 'Section 6 — Payments',
  },
  {
    idSuffix: 'payment-currency',
    key: 'payment.currency',
    text:
      'Default currency is TZS; locale sw-TZ; timezone Africa/Dar_es_Salaam. Display-currency overrides allowed per user via the currency-preferences chain.',
    rationale: 'Inherited from tenant settings + Section 6.',
    confidence: 0.95,
    sectionRef: 'Section 6 — Currency posture',
  },
  // ── Section 14 — operational stress ---------------------------------------
  {
    idSuffix: 'pain-areas-calculation',
    key: 'pain.areas_calculation_drift',
    text:
      'Manual Excel-based "areas" (arrears) calculation is the biggest operational stressor. Canonical ledger + interactive verification + audit trail must supersede the manual workflow.',
    rationale: 'Section 14 — operational pain point.',
    confidence: 0.95,
    sectionRef: 'Section 14 — Operational',
  },
];

// ---------------------------------------------------------------------------
// Core memory blocks — Letta-style persistent self-summary the kernel
// injects at the TOP of every system prompt for this tenant. We keep
// these short and imperative; the questionnaire's full text lives in
// `Docs/requirements/` and is consulted on-demand by the doc-chat tool.
// ---------------------------------------------------------------------------

interface TrcCoreBlock {
  readonly idSuffix: string;
  readonly blockKind: 'persona' | 'human' | 'preferences' | 'project';
  readonly text: string;
}

const TRC_CORE_BLOCKS: readonly TrcCoreBlock[] = [
  {
    idSuffix: 'project-profile',
    blockKind: 'project',
    text:
      'This tenant is a large multi-district public-sector estate operator. Geo hierarchy: District > Region > Station > Asset (Districts contain Regions). Approval threshold: 500,000 TZS/month splits EMU-only vs DG-routing. Default currency TZS, locale sw-TZ, timezone Africa/Dar_es_Salaam. Primary payment rail GePG. The brain should default to Harvard-PhD-grade estate-advisor tone with action-plan-style replies, never static reports.',
  },
  {
    idSuffix: 'preferences-elastic-architecture',
    blockKind: 'preferences',
    text:
      'Always honour the elastic-architecture directive: never force a fixed framework on this org. Approval thresholds, geo-labels, role hierarchy, property classes, and workflow rules are all owner-configured. Pull current values from tenant.settings.elasticConfig and approval_policies before making routing decisions.',
  },
  {
    idSuffix: 'preferences-known-pains',
    blockKind: 'preferences',
    text:
      'Known operational pains to actively defend against: (1) double-leasing on the same asset slice — auto-flag overlaps; (2) under-pricing of high-value assets — surface comparable-rent benchmarks before DG negotiations; (3) arrears-calculation drift versus Excel — keep the canonical ledger as source of truth and reconcile every export.',
  },
];

// ---------------------------------------------------------------------------
// Reflexion lessons — one per pain point named in the questionnaire.
// `taskTag` follows the convention used by lesson-distiller (verb.object).
// The renderer reads up to N lessons per (tenant, task_tag) bucket and
// prepends them to the next-turn system prompt.
// ---------------------------------------------------------------------------

interface TrcLesson {
  readonly idSuffix: string;
  readonly taskTag: string;
  readonly lesson: string;
  readonly evidence: string;
}

const TRC_LESSONS: readonly TrcLesson[] = [
  {
    idSuffix: 'leasing-double-lease-guard',
    taskTag: 'leasing.create',
    lesson:
      'Before confirming a new lease, query existing active leases on the same asset slice; reject or flag any temporal overlap — double-leasing is the #1 named revenue-loss cause.',
    evidence: 'questionnaire:section-3 / asset-registry pain',
  },
  {
    idSuffix: 'leasing-price-benchmark',
    taskTag: 'leasing.negotiate',
    lesson:
      'For high-value assets (rent >= 500,000 TZS/month), surface a comparable-rent band from market-rate snapshots before sending any offer — under-pricing is the named pricing pain.',
    evidence: 'questionnaire:section-3 / pricing pain',
  },
  {
    idSuffix: 'arrears-canonical-ledger',
    taskTag: 'arrears.compute',
    lesson:
      'Compute arrears from the canonical ledger entries; never round-trip through Excel exports. If a discrepancy is flagged, reconcile against payment_intents and GePG receipts, not against the operator\'s spreadsheet.',
    evidence: 'questionnaire:section-14 / areas-calculation drift',
  },
  {
    idSuffix: 'approval-route-by-threshold',
    taskTag: 'approval.route',
    lesson:
      'Route lease requests by asset type AND monthly rent. Bareland >= 500K -> DCEI then DG; developed >= 500K -> DG direct; below 500K -> EMU only. Thresholds are configurable per-tenant — read from tenants.settings.elasticConfig.approvalThresholds.',
    evidence: 'questionnaire:section-1 / approval flow pseudocode',
  },
  {
    idSuffix: 'station-routing-by-proximity',
    taskTag: 'application.route',
    lesson:
      'Tenant applications must route to the nearest station master / designated individual by proximity to the target asset, not by district-only mapping. Use geo_assignments.responsibility plus station coordinates.',
    evidence: 'questionnaire:section-1 / station-office-initiated workflow',
  },
  {
    idSuffix: 'docs-expiry-awareness',
    taskTag: 'documents.expiry',
    lesson:
      'Treat document expiry as a first-class trigger: when a document with expires_at is within 30 days of expiry, notify the designated person AND prepare a side-by-side old-vs-new view for review.',
    evidence: 'questionnaire:section-8 / document intelligence',
  },
  {
    idSuffix: 'maintenance-evidence-bundle',
    taskTag: 'maintenance.intake',
    lesson:
      'For every maintenance ticket, guide the tenant through evidence capture (photos + short video) BEFORE the cost-assessment step. Mediation is faster and more defensible when evidence precedes negotiation.',
    evidence: 'questionnaire:section-7 / maintenance flow',
  },
];

// ---------------------------------------------------------------------------
// Seed runner.
// ---------------------------------------------------------------------------

export interface TrcQuestionnaireBaselineResult {
  readonly semanticFactsWritten: number;
  readonly coreBlocksWritten: number;
  readonly lessonsWritten: number;
}

/**
 * Idempotent ingest. Reuses TRC_TENANT_ID so the baseline only touches
 * the TRC test tenant — never a production tenant.
 */
export async function seedTrcQuestionnaireBaseline(
  db: DatabaseClient,
): Promise<TrcQuestionnaireBaselineResult> {
  console.log('[trc-baseline] starting questionnaire baseline ingest');

  await db.transaction(async (tx) => {
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Semantic facts — tenant-scoped (user_id NULL).
    for (const fact of TRC_SEMANTIC_FACTS) {
      await tx
        .insert(kernelMemorySemantic)
        .values({
          id: `trc-mem-${fact.idSuffix}`,
          tenantId: TRC_TENANT_ID,
          userId: null,
          key: fact.key,
          value: {
            text: fact.text,
            rationale: fact.rationale,
            sectionRef: fact.sectionRef,
          },
          confidence: fact.confidence,
          sourceTurnId: null,
          evidenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          source: 'declared',
        })
        .onConflictDoNothing();
    }

    // 2. Core memory blocks — persona-scoped self-summary.
    for (const block of TRC_CORE_BLOCKS) {
      await tx
        .insert(coreMemoryBlocks)
        .values({
          id: `trc-cmb-${block.idSuffix}`,
          tenantId: TRC_TENANT_ID,
          userId: null,
          personaId: TRC_BRAIN_PERSONA_ID,
          blockKind: block.blockKind,
          blockText: block.text,
          metadata: {
            source: 'questionnaire-baseline',
            seededAt: nowIso,
          },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    // 3. Reflexion lessons — pre-canned pain-point teaching material.
    for (const lesson of TRC_LESSONS) {
      await tx
        .insert(reflexionLessons)
        .values({
          id: `trc-lesson-${lesson.idSuffix}`,
          tenantId: TRC_TENANT_ID,
          taskTag: lesson.taskTag,
          lesson: lesson.lesson,
          evidence: lesson.evidence,
          createdAt: nowIso,
          recencyScore: 0.5,
        })
        .onConflictDoNothing();
    }
  });

  const result: TrcQuestionnaireBaselineResult = {
    semanticFactsWritten: TRC_SEMANTIC_FACTS.length,
    coreBlocksWritten: TRC_CORE_BLOCKS.length,
    lessonsWritten: TRC_LESSONS.length,
  };

  console.log(
    `[trc-baseline] semantic_facts=${result.semanticFactsWritten} core_blocks=${result.coreBlocksWritten} lessons=${result.lessonsWritten}`,
  );
  return result;
}

// Re-exports for the test layer + downstream callers that need to assert
// the seeded shape without re-reading the file.
export const TRC_BASELINE_SEMANTIC_FACTS = TRC_SEMANTIC_FACTS;
export const TRC_BASELINE_CORE_BLOCKS = TRC_CORE_BLOCKS;
export const TRC_BASELINE_LESSONS = TRC_LESSONS;
