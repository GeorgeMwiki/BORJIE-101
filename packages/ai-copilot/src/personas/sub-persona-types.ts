/**
 * Sub-Persona Types - Differential prompt-layer architecture.
 *
 * There is ONE Borjie AI mind. The primary persona gives it the base
 * identity for a portal. Sub-persona layers are EXTENSIONS of that mind,
 * activated by context signals, like flexing a different muscle for a
 * different task. No separate agents. Same model call. <1ms activation.
 *
 * Architecture:
 *   Borjie AI (the ONE identity per portal)
 *   |-- finance dimension (arrears, M-Pesa, owner statements, KRA)
 *   |-- leasing dimension (renewals, negotiations, lease lifecycle)
 *   |-- maintenance dimension (case triage, tenders, FAR)
 *   |-- compliance dimension (DPA 2019, KRA, landlord-tenant law, notices)
 *   |-- communications dimension (tenant/owner letters, campaigns, Swahili)
 *   |-- professor dimension (Socratic teaching, Bloom's-adaptive)
 *   |-- advisor dimension (Harvard-PhD-level estate-ops strategy)
 *
 * All dimensions REPORT TO the primary persona. The transition is seamless.
 * No handoff, no new greeting, just the same voice with new expertise.
 */

// ============================================================================
// Sub-Persona Identifiers
// ============================================================================

/**
 * 7 sub-persona dimensions. Each maps to a differential prompt layer
 * that is appended to the primary persona's system prompt when activated.
 */
export type SubPersonaId =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'professor'
  | 'advisor'
  | 'consultant';

// ============================================================================
// Sub-Persona Configuration
// ============================================================================

export interface SubPersonaToneOverrides {
  readonly warmth: 'cool' | 'warm' | 'enthusiastic';
  readonly depth: 'surface' | 'moderate' | 'deep';
  readonly pace: 'brisk' | 'measured' | 'patient';
  readonly formality: 'casual' | 'professional' | 'academic';
}

/**
 * Metadata surfaced next to the prompt layer. Versioning lets us A/B
 * two prompt revisions safely, and the token estimate feeds the
 * AI-cost ledger's per-tenant budget accounting so a sub-persona
 * activation doesn't surprise the owner with a 3,000-token bill.
 *
 * Wave 26 wired this — previously the `*_METADATA` consts were
 * exported per-file but never read anywhere, so version bumps were
 * invisible to ops. The SUB_PERSONA_METADATA_REGISTRY below now
 * surfaces them in one typed map.
 */
export interface SubPersonaMetadata {
  readonly id: SubPersonaId;
  readonly version: string;
  readonly promptTokenEstimate: number;
  readonly activationRoutes: ReadonlyArray<string>;
}

export interface SubPersonaConfig {
  readonly id: SubPersonaId;
  readonly displayLabel: string;
  readonly displayLabelSw: string;

  /** Differential prompt layer appended to the base persona prompt. */
  readonly promptLayer: string;

  /** Tone adjustments (override base persona defaults). */
  readonly toneOverrides: SubPersonaToneOverrides;

  /** Extra tools this dimension prefers (union with base persona tools). */
  readonly preferredTools: ReadonlyArray<string>;

  /** Route patterns that trigger this sub-persona (glob-ish). */
  readonly routePatterns: ReadonlyArray<string>;

  /** Keyword signals that strengthen this sub-persona detection. */
  readonly keywordSignals: ReadonlyArray<string>;
}

// ============================================================================
// Sub-Persona Routing Signals
// ============================================================================

export interface SubPersonaSignal {
  readonly source:
    | 'route'
    | 'keyword'
    | 'chat_mode'
    | 'emotion'
    | 'auth'
    | 'session';
  readonly dimension: SubPersonaId;
  readonly weight: number;
  readonly detail: string;
}

export interface SubPersonaDetectionResult {
  readonly subPersona: SubPersonaId;
  readonly confidence: number;
  readonly signals: ReadonlyArray<SubPersonaSignal>;
}

// ============================================================================
// Registry
// ============================================================================

import {
  FINANCE_PROMPT_LAYER,
  FINANCE_METADATA,
} from './sub-personas/finance-persona.js';
import {
  LEASING_PROMPT_LAYER,
  LEASING_METADATA,
} from './sub-personas/leasing-persona.js';
import {
  MAINTENANCE_PROMPT_LAYER,
  MAINTENANCE_METADATA,
} from './sub-personas/maintenance-persona.js';
import {
  COMPLIANCE_PROMPT_LAYER,
  COMPLIANCE_METADATA,
} from './sub-personas/compliance-persona.js';
import {
  COMMUNICATIONS_PROMPT_LAYER,
  COMMUNICATIONS_METADATA,
} from './sub-personas/communications-persona.js';
import {
  PROFESSOR_PROMPT_LAYER,
  PROFESSOR_METADATA,
} from './sub-personas/professor-persona.js';
import {
  ADVISOR_PROMPT_LAYER,
  ADVISOR_METADATA,
} from './sub-personas/advisor-persona.js';
import {
  CONSULTANT_PROMPT_LAYER,
  CONSULTANT_METADATA,
} from './sub-personas/consultant-persona.js';

export const SUB_PERSONA_REGISTRY: Readonly<Record<SubPersonaId, SubPersonaConfig>> = {
  finance: {
    id: 'finance',
    displayLabel: 'Borjie Finance',
    displayLabelSw: 'Fedha ya Borjie',
    promptLayer: FINANCE_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'deep',
      pace: 'measured',
      formality: 'professional',
    },
    preferredTools: [
      'skill.kenya.mpesa_reconcile',
      'skill.kenya.kra_rental_summary',
      'skill.kenya.service_charge_reconcile',
      'skill.finance.draft_owner_statement',
      'skill.finance.draft_arrears_notice',
      'get_tenant_risk_drivers',
      'get_property_rollup',
    ],
    routePatterns: [
      '/finance/*',
      '/arrears/*',
      '/statements/*',
      '/payments/*',
      '/ledger/*',
    ],
    keywordSignals: [
      'arrears',
      'mpesa',
      'm-pesa',
      'kra',
      'owner statement',
      'rent payment',
      'service charge',
      'invoice',
      'receipt',
      'ledger',
      'balance',
      'outstanding',
      'overdue',
      'refund',
      'write-off',
    ],
  },

  leasing: {
    id: 'leasing',
    displayLabel: 'Borjie Leasing',
    displayLabelSw: 'Upangaji wa Borjie',
    promptLayer: LEASING_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'deep',
      pace: 'measured',
      formality: 'professional',
    },
    preferredTools: [
      'skill.leasing.abstract',
      'skill.leasing.renewal_propose',
      'skill.leasing.negotiation_open',
      'skill.leasing.negotiation_counter',
      'skill.leasing.negotiation_close',
      'get_unit_health',
    ],
    routePatterns: [
      '/leasing/*',
      '/leases/*',
      '/renewals/*',
      '/negotiations/*',
      '/applicants/*',
    ],
    keywordSignals: [
      'lease',
      'renewal',
      'applicant',
      'viewing',
      'move-in',
      'move-out',
      'rent increase',
      'negotiate',
      'counter offer',
      'deposit',
      'vacancy',
      'tenancy',
    ],
  },

  maintenance: {
    id: 'maintenance',
    displayLabel: 'Borjie Maintenance',
    displayLabelSw: 'Matengenezo ya Borjie',
    promptLayer: MAINTENANCE_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'deep',
      pace: 'brisk',
      formality: 'professional',
    },
    preferredTools: [
      'skill.maintenance.triage',
      'skill.maintenance.assign_work_order',
      'get_unit_health',
      'get_vendor_scorecard',
    ],
    routePatterns: [
      '/maintenance/*',
      '/work-orders/*',
      '/tenders/*',
      '/vendors/*',
      '/cases/*',
    ],
    keywordSignals: [
      'maintenance',
      'repair',
      'work order',
      'vendor',
      'tender',
      'bid',
      'caretaker',
      'leak',
      'electrical',
      'plumbing',
      'emergency',
      'inspection',
      'far',
      'fix',
      'broken',
    ],
  },

  compliance: {
    id: 'compliance',
    displayLabel: 'Borjie Compliance',
    displayLabelSw: 'Uzingatiaji wa Borjie',
    promptLayer: COMPLIANCE_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'cool',
      depth: 'deep',
      pace: 'measured',
      formality: 'professional',
    },
    preferredTools: [
      'get_parcel_compliance',
      'get_case_timeline',
      'generate_evidence_pack',
    ],
    routePatterns: [
      '/compliance/*',
      '/cases/*',
      '/evidence/*',
      '/notices/legal/*',
    ],
    keywordSignals: [
      'dpa',
      'data protection',
      'compliance',
      'kra',
      'legal',
      'eviction',
      'termination',
      'notice',
      'audit',
      'evidence',
      'dispute',
      'court',
      'landlord-tenant act',
      'data subject',
    ],
  },

  communications: {
    id: 'communications',
    displayLabel: 'Borjie Communications',
    displayLabelSw: 'Mawasiliano ya Borjie',
    promptLayer: COMMUNICATIONS_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'moderate',
      pace: 'brisk',
      formality: 'casual',
    },
    preferredTools: [
      'skill.comms.draft_tenant_notice',
      'skill.comms.draft_campaign',
      'skill.kenya.swahili_draft',
    ],
    routePatterns: [
      '/communications/*',
      '/notices/*',
      '/campaigns/*',
      '/messages/*',
    ],
    keywordSignals: [
      'notice',
      'letter',
      'announcement',
      'campaign',
      'sms',
      'whatsapp',
      'email to',
      'draft a',
      'swahili',
      'sheng',
      'reminder',
      'broadcast',
    ],
  },

  professor: {
    id: 'professor',
    displayLabel: 'Borjie Professor',
    displayLabelSw: 'Mwalimu wa Borjie',
    promptLayer: PROFESSOR_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'enthusiastic',
      depth: 'deep',
      pace: 'patient',
      formality: 'academic',
    },
    preferredTools: ['skill.core.advise'],
    routePatterns: ['/learning/*', '/training/*', '/academy/*', '/onboarding/*'],
    keywordSignals: [
      'teach me',
      'learn about',
      'explain the concept',
      'walk me through the concept',
      'show me how to',
      'why does',
      'practice problem',
      'quiz me',
      'study mode',
    ],
  },

  consultant: {
    id: 'consultant',
    displayLabel: 'Borjie Consultant',
    displayLabelSw: 'Mshauri wa Kimkakati wa Borjie',
    promptLayer: CONSULTANT_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'deep',
      pace: 'measured',
      formality: 'professional',
    },
    preferredTools: [
      'get_portfolio_overview',
      'get_property_rollup',
      'skill.core.advise',
      'skill.estate.dcf_valuation',
      'skill.estate.npv_repair_vs_replace',
      'skill.estate.board_report_composer',
      'skill.estate.rent_repricing_memo',
      // Organization-health query — prioritised for "how are we doing"
      // style questions so the orchestrator picks this over streaming
      // conversational text.
      'query_organization',
    ],
    routePatterns: ['/strategy/*', '/advisory/*', '/consulting/*'],
    keywordSignals: [
      'strategic advice',
      'help me structure',
      'what should i do about',
      'draft a strategy',
      'draft a plan',
      'advise me on',
      'structure the deal',
      'refinance or sell',
      'refurbish or divest',
      'should we acquire',
      'how do i decide',
      'board memo',
      'recommendation memo',
      'trade-offs',
      'options analysis',
      'decision memo',
      'first 90 days',
      'post-acquisition plan',
      // Organization-health query signals — route "how are we doing?"
      // style questions to the consultant so the orchestrator invokes
      // the `query_organization` tool instead of streaming a generic
      // conversational reply.
      'how are we doing',
      'how is our performance',
      'how is the portfolio performing',
      'what are our bottlenecks',
      "what's our biggest issue",
      'what is our biggest issue',
      'show me improvements',
      'show me our bottlenecks',
      'how has arrears resolution improved',
      'what should we focus on',
      'where are we losing money',
    ],
  },

  advisor: {
    id: 'advisor',
    displayLabel: 'Borjie Strategic Advisor',
    displayLabelSw: 'Mshauri Mkuu wa Borjie',
    promptLayer: ADVISOR_PROMPT_LAYER,
    toneOverrides: {
      warmth: 'warm',
      depth: 'deep',
      pace: 'measured',
      formality: 'professional',
    },
    preferredTools: [
      'get_portfolio_overview',
      'get_property_rollup',
      'skill.core.advise',
    ],
    routePatterns: ['/strategy/*', '/portfolio/*', '/insights/*', '/dashboard'],
    keywordSignals: [
      'strategy',
      'portfolio',
      'should i',
      'advise',
      'recommend',
      'scenario',
      'projection',
      'forecast',
      'optimize',
      'benchmark',
      'roi',
      'yield',
      'long term',
      'growth plan',
    ],
  },
} as const;

// ============================================================================
// Helpers
// ============================================================================

export function getSubPersona(id: SubPersonaId): SubPersonaConfig {
  return SUB_PERSONA_REGISTRY[id];
}

/**
 * Return all sub-persona configs whose route patterns match `route`.
 * Pattern semantics: suffix `/*` matches any prefix; exact match otherwise.
 */
export function getSubPersonasForRoute(route: string): ReadonlyArray<SubPersonaConfig> {
  const lower = route.toLowerCase();
  return Object.values(SUB_PERSONA_REGISTRY).filter((sp) =>
    sp.routePatterns.some((pattern) => {
      const p = pattern.toLowerCase();
      if (p.endsWith('/*')) return lower.startsWith(p.slice(0, -2));
      if (p.endsWith('*')) return lower.startsWith(p.slice(0, -1));
      return lower === p;
    }),
  );
}

// ============================================================================
// Metadata Registry (Wave 26 wiring)
// ============================================================================
// Every per-file `*_METADATA` const is exported but was never read anywhere
// — Wave 25 Agent T flagged this as dead-code-ish (planned logic without
// a consumer). Wave 26 wires them here so version bumps + token estimates
// + activation-route audits are observable to ops.
//
// Typed via `satisfies` so the registry stays a literal that TypeScript
// can narrow, while still structurally matching `SubPersonaMetadata`.

export const SUB_PERSONA_METADATA_REGISTRY = {
  finance: FINANCE_METADATA,
  leasing: LEASING_METADATA,
  maintenance: MAINTENANCE_METADATA,
  compliance: COMPLIANCE_METADATA,
  communications: COMMUNICATIONS_METADATA,
  professor: PROFESSOR_METADATA,
  advisor: ADVISOR_METADATA,
  consultant: CONSULTANT_METADATA,
} as const satisfies Readonly<Record<SubPersonaId, SubPersonaMetadata>>;

export function getSubPersonaMetadata(id: SubPersonaId): SubPersonaMetadata {
  return SUB_PERSONA_METADATA_REGISTRY[id];
}

/**
 * Sum the prompt-token estimates of every sub-persona a route activates.
 * Feeds the ai-cost-ledger's per-tenant budget accounting so the brain
 * can pre-check whether activating a heavy sub-persona (e.g. professor
 * at 2,700 tokens) would blow a tenant's monthly cap.
 */
export function estimateSubPersonaTokensForRoute(route: string): number {
  const configs = getSubPersonasForRoute(route);
  return configs.reduce(
    (sum, cfg) => sum + SUB_PERSONA_METADATA_REGISTRY[cfg.id].promptTokenEstimate,
    0,
  );
}

/**
 * Version snapshot for operator audit — which prompt version of each
 * sub-persona is live in production. Exposed via /api/v1/brain/prompt-versions
 * (see ai-chat.router) in Wave 26.
 */
export function getSubPersonaVersions(): Readonly<Record<SubPersonaId, string>> {
  const out = {} as Record<SubPersonaId, string>;
  for (const id of Object.keys(SUB_PERSONA_METADATA_REGISTRY) as SubPersonaId[]) {
    out[id] = SUB_PERSONA_METADATA_REGISTRY[id].version;
  }
  return out;
}
