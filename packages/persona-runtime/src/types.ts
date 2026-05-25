/**
 * Persona runtime — core types and Zod schemas.
 *
 * Power tiers are LOCKED at five levels. Tenants relabel them via the
 * `titles` table (TRC says "Director General", a hotel says "GM", a
 * university says "VC" — they all map to power_tier 2). The brain
 * routes on tier, not label.
 *
 * Title → tier table (the canonical mapping):
 *   T1 OWNER     — org founder / board / ultimate auth
 *   T2 ADMIN     — top operational lead (DG / CEO / GM / VC)
 *   T3 MANAGER   — dept/region/module head
 *   T4 EMPLOYEE  — field staff
 *   T5 CUSTOMER  — external (lessee / guest / student / vendor)
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Power tier
// ─────────────────────────────────────────────────────────────────────

/**
 * Fixed five-level power tier. Reads as: lower number = more power.
 */
export const POWER_TIERS = [1, 2, 3, 4, 5] as const;
export type PowerTier = (typeof POWER_TIERS)[number];

export const POWER_TIER_LABEL: Record<PowerTier, string> = Object.freeze({
  1: 'OWNER',
  2: 'ADMIN',
  3: 'MANAGER',
  4: 'EMPLOYEE',
  5: 'CUSTOMER',
});

export const PowerTierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

// ─────────────────────────────────────────────────────────────────────
// Action stakes — mirrors central-intelligence ActionToolStakes but
// normalised to upper case for the policy gate's max_action_tier.
// ─────────────────────────────────────────────────────────────────────

export const ACTION_TIERS = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'SOVEREIGN',
] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export const ActionTierSchema = z.enum(ACTION_TIERS);

/** Ranking of action tiers for ≤ comparisons. */
const ACTION_TIER_RANK: Record<ActionTier, number> = Object.freeze({
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  SOVEREIGN: 3,
});

/** True iff `proposed` is allowed under `ceiling`. */
export function isActionTierAllowed(
  proposed: ActionTier,
  ceiling: ActionTier,
): boolean {
  return ACTION_TIER_RANK[proposed] <= ACTION_TIER_RANK[ceiling];
}

// ─────────────────────────────────────────────────────────────────────
// Channel
// ─────────────────────────────────────────────────────────────────────

export const CHANNELS = [
  'web',
  'mobile',
  'whatsapp',
  'sms',
  'voice',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const ChannelSchema = z.enum(CHANNELS);

// ─────────────────────────────────────────────────────────────────────
// Scope predicate — JSON template stored in personas.scope_predicate_jsonb
// ─────────────────────────────────────────────────────────────────────

/**
 * Scope predicate kinds. Generic enough to fit any jurisdiction:
 *
 *   - tenant_scope    — "everything in tenant X"
 *   - org_scope       — "everything in organization Y inside tenant X"
 *   - module_scope    — "everything inside module M (maintenance, leasing, ...)"
 *   - region_scope    — "everything in region R (north, south, ...)"
 *   - own_records     — "rows whose owner_user_id equals the caller"
 *   - none            — "no access" (sentinel — useful for kill-switched personas)
 *   - all             — "platform-wide" (T1 sovereign analysts)
 */
export const SCOPE_KINDS = [
  'tenant_scope',
  'org_scope',
  'module_scope',
  'region_scope',
  'own_records',
  'none',
  'all',
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const ScopePredicateSchema = z.object({
  kind: z.enum(SCOPE_KINDS),
  tenant_id: z.string().optional(),
  org_id: z.string().optional(),
  module: z.string().optional(),
  region: z.string().optional(),
  user_id: z.string().optional(),
});
export type ScopePredicate = z.infer<typeof ScopePredicateSchema>;

// ─────────────────────────────────────────────────────────────────────
// Title
// ─────────────────────────────────────────────────────────────────────

export const TitleSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  slug: z.string().min(1),
  displayNameEn: z.string().min(1),
  displayNameSw: z.string().optional(),
  powerTier: PowerTierSchema,
  isBuiltIn: z.boolean().default(false),
  icon: z.string().optional(),
  createdAt: z.date().optional(),
});
export type Title = z.infer<typeof TitleSchema>;

// ─────────────────────────────────────────────────────────────────────
// Persona
// ─────────────────────────────────────────────────────────────────────

export const PersonaSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  slug: z.string().min(1),
  displayNameEn: z.string().min(1),
  displayNameSw: z.string().optional(),
  powerTier: PowerTierSchema,
  scopePredicate: ScopePredicateSchema,
  toolCatalogIds: z.array(z.string()),
  channelAllowlist: z.array(ChannelSchema).min(1),
  maxActionTier: ActionTierSchema,
  memoryNamespaceTemplate: z.string().min(1),
  uiSectionFilter: z.array(z.string()).default([]),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.date().optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

// ─────────────────────────────────────────────────────────────────────
// Persona binding
// ─────────────────────────────────────────────────────────────────────

export const PersonaBindingSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  titleId: z.string().min(1),
  personaId: z.string().min(1),
  isDefault: z.boolean().default(false),
  createdAt: z.date().optional(),
});
export type PersonaBinding = z.infer<typeof PersonaBindingSchema>;

// ─────────────────────────────────────────────────────────────────────
// Authorization context — passed into computeToolCatalog / scope check
// ─────────────────────────────────────────────────────────────────────

export const AuthorizationContextSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  /** Active persona id (after binding-resolver picks a default or the user selects one). */
  personaId: z.string().min(1),
  /** Optional org binding for module_scope evaluations. */
  orgId: z.string().optional(),
  /** Active module hint, e.g. 'maintenance', 'leasing'. */
  moduleId: z.string().optional(),
  /** Active region hint when persona is region_scope. */
  regionId: z.string().optional(),
  /** Caller's channel for the current request. */
  channel: ChannelSchema.default('web'),
  /** Sentinel — when TRUE the gate refuses every tool. */
  killSwitchOpen: z.boolean().default(false),
  /** Feature-flag bag merged from the kill_switch + feature-flags. */
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});
export type AuthorizationContext = z.infer<typeof AuthorizationContextSchema>;

// ─────────────────────────────────────────────────────────────────────
// Memory namespace
// ─────────────────────────────────────────────────────────────────────

export const MemoryNamespaceSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  personaId: z.string().min(1),
  projectId: z.string().optional(),
  moduleId: z.string().optional(),
  namespaceKey: z.string().min(1),
  createdAt: z.date().optional(),
});
export type MemoryNamespace = z.infer<typeof MemoryNamespaceSchema>;

// ─────────────────────────────────────────────────────────────────────
// Ticket — cross-persona escalation
// ─────────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'approved',
  'rejected',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TicketSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  sourcePersonaId: z.string().min(1),
  targetPersonaId: z.string().optional(),
  targetUserId: z.string().optional(),
  title: z.string().min(1),
  bodyJsonb: z.record(z.string(), z.unknown()).default({}),
  requiredApprovalPolicyId: z.string().optional(),
  status: z.enum(TICKET_STATUSES).default('open'),
  createdByUserId: z.string().min(1),
  createdAt: z.date().optional(),
  resolvedAt: z.date().optional(),
});
export type Ticket = z.infer<typeof TicketSchema>;
