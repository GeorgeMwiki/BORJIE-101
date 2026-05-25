/**
 * @borjie/executive-brief-engine — types.
 *
 * Zod schemas + TypeScript types for the structured ExecutiveBrief.
 *
 * The CRITICAL invariant: every gap/opportunity/risk MUST cite at least
 * one core_entity.id or audit_event.id. The brief assembler refuses to
 * return a brief whose claims are uncited. This is enforced at the
 * Zod layer (`.refine`) and again at the SQL layer (jsonb sanity check
 * in `brief-assembler.ts`).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Severity / confidence
// ─────────────────────────────────────────────────────────────────────

export const SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];
export const SeveritySchema = z.enum(SEVERITY_LEVELS);

// ─────────────────────────────────────────────────────────────────────
// Citation — links a claim back to a concrete piece of evidence.
//
// `claimIndex` refers to the array index within the brief's
// gaps/opportunities/risks/recommended_actions arrays. Exactly one of
// `entityId` or `auditEventId` is required. `page` is for document
// citations (Piece K).
// ─────────────────────────────────────────────────────────────────────

export const CitationSchema = z
  .object({
    claimIndex: z.number().int().min(0),
    claimKind: z.enum(['gap', 'opportunity', 'risk', 'recommended_action']),
    entityId: z.string().optional(),
    auditEventId: z.string().optional(),
    documentId: z.string().optional(),
    page: z.number().int().min(1).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (c) => Boolean(c.entityId || c.auditEventId || c.documentId),
    {
      message:
        'Citation must reference at least one of entityId, auditEventId, or documentId',
    },
  );
export type Citation = z.infer<typeof CitationSchema>;

// ─────────────────────────────────────────────────────────────────────
// Findings (gaps / opportunities / risks share the shape)
// ─────────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: SeveritySchema,
  /**
   * Indices into the brief's `citations` array. Every finding MUST
   * have at least one citation — the brief assembler refuses to
   * publish a brief whose findings have no backing.
   */
  citationIndices: z.array(z.number().int().min(0)).min(1, {
    message: 'Every finding must cite at least one evidence reference',
  }),
  /** Optional confidence in the finding (0..1). */
  confidence: z.number().min(0).max(1).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const GapSchema = FindingSchema;
export type Gap = Finding;
export const OpportunitySchema = FindingSchema;
export type Opportunity = Finding;
export const RiskSchema = FindingSchema;
export type Risk = Finding;

// ─────────────────────────────────────────────────────────────────────
// Recommended action — a concrete Piece B / Piece L action with payload
// ─────────────────────────────────────────────────────────────────────

export const RecommendedActionSchema = z.object({
  title: z.string().min(1).max(200),
  /** Module template id — must match a row in `module_templates` (Piece B). */
  targetModule: z.string().min(1).max(64),
  /** Action slug, e.g. 'create_lease_renewal_offer'. */
  action: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  /** Citations supporting this recommendation. */
  citationIndices: z.array(z.number().int().min(0)).min(1, {
    message: 'Every recommended action must cite supporting evidence',
  }),
  /** Whether this action requires four-eye approval (HIGH+ stakes). */
  requiresApproval: z.boolean().default(false),
});
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

// ─────────────────────────────────────────────────────────────────────
// Approval packet — prebuilt K5 four-eye payload, ready to fire when
// the executive clicks "Approve" on a recommended action.
// ─────────────────────────────────────────────────────────────────────

export const ApprovalPacketSchema = z.object({
  /** Index into the brief's `recommendedActions` array. */
  actionIndex: z.number().int().min(0),
  /** Policy id from authz-policy. */
  policyId: z.string().min(1),
  /** Required approvers — array of persona-tier descriptors. */
  requiredApprovers: z.array(
    z.object({
      powerTier: z.number().int().min(1).max(5),
      scope: z.enum(['tenant', 'org', 'module']).default('tenant'),
    }),
  ).min(1),
  /** Pre-rendered approval payload (what the approver sees). */
  payload: z.record(z.string(), z.unknown()),
});
export type ApprovalPacket = z.infer<typeof ApprovalPacketSchema>;

// ─────────────────────────────────────────────────────────────────────
// Brief scope
// ─────────────────────────────────────────────────────────────────────

export const BriefScopeSchema = z.object({
  modules: z.array(z.string()).default([]),
  /** ISO-8601 duration (P7D, P1M, ...). */
  timeWindow: z.string().regex(/^P(\d+)(D|W|M|Y)$/, {
    message: 'Time window must be ISO-8601 (P7D, P1M, ...)',
  }),
  focusEntities: z.array(z.string()).default([]),
});
export type BriefScope = z.infer<typeof BriefScopeSchema>;

// ─────────────────────────────────────────────────────────────────────
// The full executive brief
// ─────────────────────────────────────────────────────────────────────

export const ExecutiveBriefSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    personaId: z.string().min(1),
    scope: BriefScopeSchema,
    gaps: z.array(GapSchema).default([]),
    opportunities: z.array(OpportunitySchema).default([]),
    risks: z.array(RiskSchema).default([]),
    recommendedActions: z.array(RecommendedActionSchema).default([]),
    approvalPackets: z.array(ApprovalPacketSchema).default([]),
    citations: z.array(CitationSchema).default([]),
    locale: z.string().min(2).max(8).default('en'),
    generatedAt: z.date(),
    periodStart: z.date(),
    periodEnd: z.date(),
    generatorVersion: z.string().min(1),
    costMicros: z.number().int().min(0).optional(),
    hash: z.string().min(1),
    prevHash: z.string().nullable(),
    auditChainLink: z.string().nullable(),
    status: z.enum(['GENERATED', 'VIEWED', 'ACTIONED', 'DISMISSED', 'ARCHIVED']).default('GENERATED'),
    degraded: z.boolean().default(false),
  })
  .refine(
    (b) => {
      // Validate that every citationIndex referenced by a finding is in
      // bounds of the citations array.
      const total = b.citations.length;
      for (const f of [...b.gaps, ...b.opportunities, ...b.risks]) {
        for (const ci of f.citationIndices) {
          if (ci < 0 || ci >= total) return false;
        }
      }
      for (const a of b.recommendedActions) {
        for (const ci of a.citationIndices) {
          if (ci < 0 || ci >= total) return false;
        }
      }
      return true;
    },
    { message: 'Every citationIndex must reference a valid index in citations[]' },
  );
export type ExecutiveBrief = z.infer<typeof ExecutiveBriefSchema>;

// ─────────────────────────────────────────────────────────────────────
// Hypothesis — pre-verification candidate from the LLM. The verifier
// upgrades surviving hypotheses to a Finding before they land in the
// brief.
// ─────────────────────────────────────────────────────────────────────

export const HypothesisSchema = z.object({
  kind: z.enum(['gap', 'opportunity', 'risk']),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: SeveritySchema,
  /**
   * Raw evidence references this hypothesis comes from. Becomes
   * `citationIndices` after the verifier maps each evidence ref into
   * a Citation row.
   */
  evidenceRefs: z.array(
    z.object({
      kind: z.enum(['entity', 'audit_event', 'document']),
      id: z.string().min(1),
      page: z.number().int().min(1).optional(),
    }),
  ).default([]),
  /** Online-judge score (0..1) — higher means more confident. */
  judgeScore: z.number().min(0).max(1).optional(),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;
