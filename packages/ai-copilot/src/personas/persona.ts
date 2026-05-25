/**
 * Persona — the unit of specialization inside the Brain.
 *
 * A Persona is NOT a separate AI. It is one reasoning mind (Claude) wearing a
 * role-scoped costume:
 *  - system prompt defines who it is and what it can do
 *  - `allowedTools` defines what it may call
 *  - `visibilityBudget` caps the width of artifacts it produces
 *  - `modelTier` + `advisorCategory` drive the Advisor pattern
 *
 * The shared Thread Store + Canonical Property Graph are its memory. No
 * persona owns private state.
 */

import { z } from 'zod';
import {
  AITenantContext,
  AIActor,
  RiskLevel,
} from '../types/core.types.js';
import { VisibilityScope } from '../thread/visibility.js';
import { AdvisorHardCategory } from '../providers/advisor.js';

/**
 * Canonical persona identifiers used across the Brain.
 *
 * `coworker.<employeeId>` is a family — the employee id is substituted at
 * runtime. The orchestrator resolves the template when binding.
 */
export const PERSONA_IDS = {
  ESTATE_MANAGER: 'estate-manager',
  JUNIOR_LEASING: 'junior.leasing',
  JUNIOR_MAINTENANCE: 'junior.maintenance',
  JUNIOR_FINANCE: 'junior.finance',
  JUNIOR_COMPLIANCE: 'junior.compliance',
  JUNIOR_COMMUNICATIONS: 'junior.communications',
  COWORKER_FAMILY: 'coworker',
  MIGRATION_WIZARD: 'migration-wizard',
  TENANT_ASSISTANT: 'tenant-assistant',
  OWNER_ADVISOR: 'owner-advisor',
  PRICE_NEGOTIATOR: 'junior.price-negotiator',
  TENDER_NEGOTIATOR: 'coworker.tender-negotiator',
} as const;

/**
 * Persona kind controls default visibility and audit surface.
 *  - `manager` — admin-facing, management scope.
 *  - `junior` — team-facing, team scope default.
 *  - `coworker` — single-employee facing, private scope default.
 *  - `utility` — infrastructure personae (e.g. migration wizard).
 */
export type PersonaKind = 'manager' | 'junior' | 'coworker' | 'utility';

/**
 * Model tier drives which Anthropic model the executor uses.
 * Maps to Sonnet / Haiku / Opus at runtime in the advisor executor.
 */
export type ModelTier = 'basic' | 'standard' | 'advanced';

/**
 * Persona definition — value-type, safe to serialize and version.
 */
export interface Persona {
  /** Unique persona id. For Coworker: `coworker.<employeeId>`. */
  id: string;
  kind: PersonaKind;
  /** Human-readable name for UI rendering. */
  displayName: string;
  /** One-sentence mission. */
  missionStatement: string;

  /** System prompt. Versioned via prompt-registry in production. */
  systemPrompt: string;

  /** Tools this persona may call — names match graph-agent-toolkit + skills. */
  allowedTools: string[];
  /** Default tools auto-invoked when a turn needs context grounding. */
  defaultContextTools?: string[];

  /** Maximum visibility scope this persona may *publish*. */
  visibilityBudget: VisibilityScope;
  /** Default visibility scope for messages this persona produces. */
  defaultVisibility: VisibilityScope;

  /** Default model tier for the executor. */
  modelTier: ModelTier;
  /** Whether Opus advisor consultations are enabled. */
  advisorEnabled: boolean;
  /** Hard categories that always route to advisor. */
  advisorHardCategories: AdvisorHardCategory[];

  /** Risk floor — below this, auto-approval is never allowed. */
  minReviewRiskLevel: RiskLevel;

  /** Which juniors this persona may delegate to (Estate Manager only). */
  delegatesTo?: string[];

  /** Team binding, required for juniors and coworkers. */
  teamId?: string;
  /** Employee binding, required for coworker personae. */
  employeeId?: string;

  /** Optional tenant scoping. If absent, persona is tenant-agnostic template. */
  tenantId?: string;
}

export const PersonaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['manager', 'junior', 'coworker', 'utility']),
  displayName: z.string().min(1),
  missionStatement: z.string().min(1),
  systemPrompt: z.string().min(1),
  allowedTools: z.array(z.string()),
  defaultContextTools: z.array(z.string()).optional(),
  visibilityBudget: z.enum(['private', 'team', 'management', 'public']),
  defaultVisibility: z.enum(['private', 'team', 'management', 'public']),
  modelTier: z.enum(['basic', 'standard', 'advanced']),
  advisorEnabled: z.boolean(),
  advisorHardCategories: z.array(
    z.enum([
      'lease_interpretation',
      'legal_drafting',
      'compliance_ruling',
      'large_financial_posting',
      'tenant_termination',
      'irreversible_action',
    ])
  ),
  minReviewRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  delegatesTo: z.array(z.string()).optional(),
  teamId: z.string().optional(),
  employeeId: z.string().optional(),
  tenantId: z.string().optional(),
});

/**
 * Runtime binding of a Persona to a specific tenant + (optionally) team /
 * employee. The template persona is immutable; the binding is the per-tenant
 * materialization.
 */
export interface PersonaBinding {
  persona: Persona;
  tenant: AITenantContext;
  /** Actor on whose behalf the persona will act. */
  actor: AIActor;
  /** Optional override for team/employee for Coworker instantiation. */
  teamId?: string;
  employeeId?: string;
}

/**
 * Instantiate a concrete Persona from a template + runtime bindings.
 * For Coworker templates, substitutes `<employeeId>` into the id.
 */
export function bindPersona(
  template: Persona,
  bindings: {
    tenantId: string;
    teamId?: string;
    employeeId?: string;
  }
): Persona {
  let id = template.id;
  if (template.kind === 'coworker' && bindings.employeeId) {
    id = `${PERSONA_IDS.COWORKER_FAMILY}.${bindings.employeeId}`;
  }
  return {
    ...template,
    id,
    tenantId: bindings.tenantId,
    teamId: bindings.teamId ?? template.teamId,
    employeeId: bindings.employeeId ?? template.employeeId,
  };
}

/**
 * Persona registry — holds template personae and resolves bindings.
 * Bindings are tenant-scoped; the registry does not cache them (the
 * orchestrator owns lifecycle).
 */
export class PersonaRegistry {
  private templates = new Map<string, Persona>();

  register(template: Persona): void {
    this.templates.set(template.id, template);
  }

  get(id: string): Persona | null {
    return this.templates.get(id) ?? null;
  }

  list(kind?: PersonaKind): Persona[] {
    const all = Array.from(this.templates.values());
    return kind ? all.filter((p) => p.kind === kind) : all;
  }

  /**
   * Resolve a coworker id `coworker.<employeeId>` back to its template.
   */
  resolveCoworker(): Persona | null {
    return this.get(PERSONA_IDS.COWORKER_FAMILY) ?? null;
  }
}
