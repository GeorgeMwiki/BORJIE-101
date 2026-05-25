/**
 * Piece L — Platform default routing matrix.
 *
 * 17 platform-default rows mapping (entity_type × intent) to a
 * (module_template_id, action) pair. The dispatcher walks the rows for
 * each capture and emits one proposal per matching row.
 *
 * Why hardcode in TS rather than read from a `routing_rules` table?
 *   - Piece B (claude/piece-b-dynamic-modules) owns the `routing_rules`
 *     persistent store; it ships in parallel and may not be on this
 *     branch.
 *   - These 17 are the minimum viable platform behaviour. Tenant-scoped
 *     overrides can ADD rows on top once Piece B lands; the matrix
 *     resolver merges `tenant_scope='*'` (default) with `tenant_scope='<id>'`
 *     (tenant override), with the latter winning on (entity_type, intent)
 *     conflicts.
 *   - Cleaner than a stub migration. The constant has no SQL dependency
 *     and can be exercised in unit tests without a DB.
 *
 * Confidence thresholds:
 *   - `min_confidence`     : below this, the rule does not fire at all
 *                            (we emit a proactive nudge instead).
 *   - `auto_apply_threshold`: at-or-above this, dispatch flips status to
 *                            `auto_applying` and calls the handler
 *                            immediately (still subject to hitl_required).
 *
 * Persona tier (1..5):
 *   - 1 = K-level director / owner (full trust)
 *   - 2 = M-tier operator (manager)
 *   - 3 = J-tier supervisor
 *   - 4 = T-tier line staff (residents, applicants)
 *   - 5 = V-tier service user (no agency over data)
 */

import type { RoutingMatrixRow } from './types.js';

/**
 * 17-row platform default. Edit history: created Piece L Wave 22.
 *
 * Ordering matters for tests + audit replay: keep the rows in canonical
 * order. New rules append; never re-order historical rows because that
 * would change the matrix_row_id (we use index-based ids).
 */
export const PLATFORM_ROUTING_MATRIX: ReadonlyArray<RoutingMatrixRow> = [
  // ─── ESTATE module — the lease / occupancy / tenancy tab ─────────────
  {
    id: 'L-ROW-01',
    entity_type: 'customer',
    intent: 'propose_action',
    module_template_id: 'ESTATE',
    action: 'create_lease_application',
    min_confidence: 0.6,
    auto_apply_threshold: 0.92,
    hitl_required: true,
    priority: 'high',
    min_approver_tier: 3,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-02',
    entity_type: 'unit',
    intent: 'propose_action',
    module_template_id: 'ESTATE',
    action: 'flag_unit_status_change',
    min_confidence: 0.6,
    auto_apply_threshold: 0.9,
    hitl_required: true,
    priority: 'medium',
    min_approver_tier: 3,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-03',
    entity_type: 'lease',
    intent: 'file_event',
    module_template_id: 'ESTATE',
    action: 'append_lease_event',
    min_confidence: 0.7,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'medium',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-04',
    entity_type: 'lease',
    intent: 'propose_action',
    module_template_id: 'ESTATE',
    action: 'amend_lease_terms',
    min_confidence: 0.7,
    auto_apply_threshold: 0.95,
    hitl_required: true,
    priority: 'high',
    min_approver_tier: 2,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── LITFIN module — money path / arrears / settlements ─────────────
  {
    id: 'L-ROW-05',
    entity_type: 'amount',
    intent: 'propose_action',
    module_template_id: 'LITFIN',
    action: 'raise_invoice',
    min_confidence: 0.7,
    auto_apply_threshold: 0.9,
    hitl_required: true,
    priority: 'high',
    min_approver_tier: 3,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-06',
    entity_type: 'invoice',
    intent: 'file_event',
    module_template_id: 'LITFIN',
    action: 'append_payment_received',
    min_confidence: 0.75,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'high',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-07',
    entity_type: 'customer',
    intent: 'file_event',
    module_template_id: 'LITFIN',
    action: 'open_arrears_case',
    min_confidence: 0.7,
    auto_apply_threshold: 0.92,
    hitl_required: true,
    priority: 'critical',
    min_approver_tier: 2,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── TRC-EMU module — TRC pilot energy meters utility tracking ─────
  {
    id: 'L-ROW-08',
    entity_type: 'unit',
    intent: 'file_event',
    module_template_id: 'TRC-EMU',
    action: 'log_meter_reading',
    min_confidence: 0.7,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'medium',
    min_approver_tier: 4,
    jurisdiction: 'TZ',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-09',
    entity_type: 'customer',
    intent: 'propose_action',
    module_template_id: 'TRC-EMU',
    action: 'enrol_consumer_account',
    min_confidence: 0.7,
    auto_apply_threshold: 0.9,
    hitl_required: true,
    priority: 'medium',
    min_approver_tier: 3,
    jurisdiction: 'TZ',
    tenant_scope: '*',
  },

  // ─── MAINTENANCE module — tickets + work orders ─────────────────────
  {
    id: 'L-ROW-10',
    entity_type: 'maintenance_ticket',
    intent: 'file_event',
    module_template_id: 'MAINTENANCE',
    action: 'append_ticket_update',
    min_confidence: 0.7,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'medium',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-11',
    entity_type: 'unit',
    intent: 'propose_action',
    module_template_id: 'MAINTENANCE',
    action: 'open_maintenance_ticket',
    min_confidence: 0.65,
    auto_apply_threshold: 0.88,
    hitl_required: true,
    priority: 'medium',
    min_approver_tier: 3,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── DOCUMENTS module — Piece K bridge ────────────────────────────
  {
    id: 'L-ROW-12',
    entity_type: 'document',
    intent: 'file_event',
    module_template_id: 'DOCUMENTS',
    action: 'attach_document',
    min_confidence: 0.7,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'low',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-13',
    entity_type: 'document',
    intent: 'propose_action',
    module_template_id: 'DOCUMENTS',
    action: 'classify_document',
    min_confidence: 0.65,
    auto_apply_threshold: 0.9,
    hitl_required: true,
    priority: 'low',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── COMPLIANCE module ────────────────────────────────────────────
  {
    id: 'L-ROW-14',
    entity_type: 'lease',
    intent: 'ask_for_help',
    module_template_id: 'COMPLIANCE',
    action: 'flag_compliance_check',
    min_confidence: 0.6,
    auto_apply_threshold: 0.85,
    hitl_required: true,
    priority: 'high',
    min_approver_tier: 2,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── INSPECTIONS module ──────────────────────────────────────────
  {
    id: 'L-ROW-15',
    entity_type: 'unit',
    intent: 'ask_for_help',
    module_template_id: 'INSPECTIONS',
    action: 'schedule_inspection',
    min_confidence: 0.65,
    auto_apply_threshold: 0.88,
    hitl_required: true,
    priority: 'medium',
    min_approver_tier: 3,
    jurisdiction: '*',
    tenant_scope: '*',
  },

  // ─── PROPERTY module ─────────────────────────────────────────────
  {
    id: 'L-ROW-16',
    entity_type: 'property',
    intent: 'file_event',
    module_template_id: 'PROPERTY',
    action: 'append_property_event',
    min_confidence: 0.7,
    auto_apply_threshold: 0.85,
    hitl_required: false,
    priority: 'low',
    min_approver_tier: 4,
    jurisdiction: '*',
    tenant_scope: '*',
  },
  {
    id: 'L-ROW-17',
    entity_type: 'property',
    intent: 'propose_action',
    module_template_id: 'PROPERTY',
    action: 'update_property_attributes',
    min_confidence: 0.7,
    auto_apply_threshold: 0.93,
    hitl_required: true,
    priority: 'medium',
    min_approver_tier: 2,
    jurisdiction: '*',
    tenant_scope: '*',
  },
];

/**
 * Auto-apply confidence threshold below which we never auto-execute,
 * regardless of matrix row. Acts as a global safety floor so a single
 * row with a generous `auto_apply_threshold: 0.7` cannot bypass HITL.
 */
export const GLOBAL_AUTO_APPLY_FLOOR = 0.85;

/**
 * Confidence threshold below which dispatch emits a proactive nudge
 * instead of creating proposals at all. Acts as the system's
 * "is this even worth bothering the user about" gate.
 */
export const ROUTER_THRESHOLD = 0.55;

/**
 * Per-tier trust baseline. Persona tier multiplies capture confidence
 * to encode "we trust higher-tier personas more". Implementation: this
 * is a MIN, not a multiplier, so a T5 persona cannot push a proposal
 * above 0.40 confidence no matter how well-articulated.
 */
export const PERSONA_TRUST_BY_TIER: Readonly<Record<number, number>> = {
  1: 1.0, // Director / K-tier
  2: 0.85, // M-tier operator
  3: 0.7, // J-tier supervisor
  4: 0.55, // T-tier line staff
  5: 0.4, // V-tier service user
};

/**
 * Tenant trust default — overridden per-tenant by trust scoring service.
 * 0.8 is the platform conservative baseline for newly-onboarded tenants.
 */
export const DEFAULT_TENANT_TRUST = 0.8;
