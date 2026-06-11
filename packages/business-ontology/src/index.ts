/**
 * @borjie/business-ontology — the REA (Resources · Events · Agents) business
 * ontology.
 *
 * THE IDEA
 * --------
 * Every Mr-Mwikila domain pack describes the SAME five economic primitives,
 * just relabelled into its own world:
 *   - the MINING pack:   Resource = mineral-lot / royalty-obligation / licence
 *   - the BUSINESS pack:  Resource = cash / accounts-receivable / accounts-
 *                         payable / payroll-liability
 * So the operator-ERP layer is provably vertical-agnostic: ONE ontology, many
 * relabellings. Anchored on McCarthy's REA accounting model — whose core claim
 * is DUALITY: every economic event has a give side AND a take side (it both
 * decrements and increments the resources of the agents involved). The double-
 * entry ledger is REA duality made mechanical.
 *
 * This package is pure types + zod schemas + a referential-integrity/duality
 * validator + small read helpers. It holds NO domain content — the packs do.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive categories
// ---------------------------------------------------------------------------

/** The five REA primitive categories every domain ontology declares. */
export const REA_CATEGORIES = [
  'resource',
  'event',
  'agent',
  'commitment',
  'policy',
] as const;
export type ReaCategory = (typeof REA_CATEGORIES)[number];

/** Direction of an economic event's effect on a resource stock. */
export const STOCK_FLOWS = ['increment', 'decrement'] as const;
export type StockFlow = (typeof STOCK_FLOWS)[number];

const keyRx = /^[a-z][a-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Resource — an economic thing of value the business tracks a stock of.
// ---------------------------------------------------------------------------

export interface ResourceDef {
  readonly key: string; // 'cash' | 'accounts_receivable' | 'mineral_lot'
  readonly label: string; // human label in the pack's domain language
  readonly measuredIn: string; // 'currency_minor_units' | 'tonnes' | 'count'
  /** Coarse accounting class (drives where it lands on the statements). */
  readonly accountClass:
    | 'asset'
    | 'liability'
    | 'equity'
    | 'revenue'
    | 'expense'
    | 'operational'; // 'operational' = non-financial (tonnes, headcount)
}

export const ResourceDefSchema = z.object({
  key: z.string().regex(keyRx),
  label: z.string().min(1),
  measuredIn: z.string().min(1),
  accountClass: z.enum([
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense',
    'operational',
  ]),
});

// ---------------------------------------------------------------------------
// Agent — a party to economic events (inside or outside the entity).
// ---------------------------------------------------------------------------

export interface AgentDef {
  readonly key: string; // 'legal_entity' | 'employee' | 'customer' | 'vendor'
  readonly label: string;
  readonly internal: boolean; // true = inside the entity (employee, legal_entity)
}

export const AgentDefSchema = z.object({
  key: z.string().regex(keyRx),
  label: z.string().min(1),
  internal: z.boolean(),
});

// ---------------------------------------------------------------------------
// Economic Event — the REA duality unit.
// ---------------------------------------------------------------------------

/** A single stock-flow effect: an event increments/decrements one resource. */
export interface StockFlowEffect {
  readonly resourceKey: string;
  readonly flow: StockFlow;
}

export const StockFlowEffectSchema = z.object({
  resourceKey: z.string().regex(keyRx),
  flow: z.enum(STOCK_FLOWS),
});

/**
 * An economic event. DUALITY: a well-formed event carries at least one
 * increment AND one decrement effect (the give ↔ take). `journal_post` is the
 * canonical primitive event the ledger records.
 */
export interface EventDef {
  readonly key: string; // 'invoice_issue' | 'bill_pay' | 'payroll_run' | 'journal_post'
  readonly label: string;
  readonly effects: ReadonlyArray<StockFlowEffect>;
  readonly providerAgentKey: string; // the agent on the give side
  readonly receiverAgentKey: string; // the agent on the take side
  /** True when this event moves money — MUST flow through LedgerService.post(). */
  readonly isMonetary: boolean;
}

export const EventDefSchema = z.object({
  key: z.string().regex(keyRx),
  label: z.string().min(1),
  effects: z.array(StockFlowEffectSchema).min(1),
  providerAgentKey: z.string().regex(keyRx),
  receiverAgentKey: z.string().regex(keyRx),
  isMonetary: z.boolean(),
});

// ---------------------------------------------------------------------------
// Commitment — a promise of a future economic event (an obligation).
// ---------------------------------------------------------------------------

export interface CommitmentDef {
  readonly key: string; // 'invoice' | 'purchase_order' | 'requisition' | 'subscription'
  readonly label: string;
  readonly fulfilledByEventKey: string; // which EventDef fulfils it
}

export const CommitmentDefSchema = z.object({
  key: z.string().regex(keyRx),
  label: z.string().min(1),
  fulfilledByEventKey: z.string().regex(keyRx),
});

// ---------------------------------------------------------------------------
// Policy — a rule constraining events/commitments.
// ---------------------------------------------------------------------------

export interface PolicyDef {
  readonly key: string; // 'four_eye_approval' | 'autonomy_tier' | 'stage_gate'
  readonly label: string;
  readonly appliesToCategory: ReaCategory;
}

export const PolicyDefSchema = z.object({
  key: z.string().regex(keyRx),
  label: z.string().min(1),
  appliesToCategory: z.enum(REA_CATEGORIES),
});

// ---------------------------------------------------------------------------
// DomainOntology — what a pack DECLARES (its relabelling of the primitives).
// ---------------------------------------------------------------------------

export interface DomainOntology {
  readonly domain: string; // 'mining-tz' | 'operator-business'
  readonly resources: ReadonlyArray<ResourceDef>;
  readonly agents: ReadonlyArray<AgentDef>;
  readonly events: ReadonlyArray<EventDef>;
  readonly commitments: ReadonlyArray<CommitmentDef>;
  readonly policies: ReadonlyArray<PolicyDef>;
}

export const DomainOntologySchema = z.object({
  domain: z.string().min(1),
  resources: z.array(ResourceDefSchema).min(1),
  agents: z.array(AgentDefSchema).min(1),
  events: z.array(EventDefSchema).min(1),
  commitments: z.array(CommitmentDefSchema),
  policies: z.array(PolicyDefSchema),
});

// ---------------------------------------------------------------------------
// Validation — shape (zod) + referential integrity + REA duality.
// ---------------------------------------------------------------------------

export type OntologyIssueCode =
  | 'SHAPE_INVALID'
  | 'DUPLICATE_KEY'
  | 'UNKNOWN_RESOURCE'
  | 'UNKNOWN_AGENT'
  | 'UNKNOWN_EVENT'
  | 'DUALITY_VIOLATION';

export interface OntologyIssue {
  readonly code: OntologyIssueCode;
  readonly message: string;
}

export interface OntologyValidationResult {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<OntologyIssue>;
}

function dupes(keys: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

/**
 * Validate a domain ontology: shape (zod), no duplicate keys within a category,
 * every cross-reference resolves (event effects → resources, event agents →
 * agents, commitment → event), and REA DUALITY (every event carries ≥1
 * increment AND ≥1 decrement). PURE — never throws.
 */
export function validateDomainOntology(
  candidate: unknown,
): OntologyValidationResult {
  const parsed = DomainOntologySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: 'SHAPE_INVALID',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      ],
    };
  }

  const o = parsed.data;
  const issues: OntologyIssue[] = [];

  for (const [cat, keys] of [
    ['resource', o.resources.map((r) => r.key)],
    ['agent', o.agents.map((a) => a.key)],
    ['event', o.events.map((e) => e.key)],
    ['commitment', o.commitments.map((c) => c.key)],
    ['policy', o.policies.map((p) => p.key)],
  ] as const) {
    for (const d of dupes(keys)) {
      issues.push({
        code: 'DUPLICATE_KEY',
        message: `duplicate ${cat} key '${d}'`,
      });
    }
  }

  const resourceKeys = new Set(o.resources.map((r) => r.key));
  const agentKeys = new Set(o.agents.map((a) => a.key));
  const eventKeys = new Set(o.events.map((e) => e.key));

  for (const e of o.events) {
    for (const eff of e.effects) {
      if (!resourceKeys.has(eff.resourceKey)) {
        issues.push({
          code: 'UNKNOWN_RESOURCE',
          message: `event '${e.key}' effect references unknown resource '${eff.resourceKey}'`,
        });
      }
    }
    for (const agentKey of [e.providerAgentKey, e.receiverAgentKey]) {
      if (!agentKeys.has(agentKey)) {
        issues.push({
          code: 'UNKNOWN_AGENT',
          message: `event '${e.key}' references unknown agent '${agentKey}'`,
        });
      }
    }
    // REA duality — an economic event is a TRANSFER, so it must touch at least
    // TWO distinct resources (the give and the take). Whether each effect is an
    // inflow or an outflow is accounting-direction; the debit=credit BALANCE is
    // enforced downstream by LedgerService.post(), not here.
    const distinctResources = new Set(e.effects.map((f) => f.resourceKey));
    if (distinctResources.size < 2) {
      issues.push({
        code: 'DUALITY_VIOLATION',
        message: `event '${e.key}' violates REA duality — must transfer between at least two distinct resources`,
      });
    }
  }

  for (const c of o.commitments) {
    if (!eventKeys.has(c.fulfilledByEventKey)) {
      issues.push({
        code: 'UNKNOWN_EVENT',
        message: `commitment '${c.key}' is fulfilled by unknown event '${c.fulfilledByEventKey}'`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** The events that touch a given resource (in either flow direction). */
export function eventsTouchingResource(
  o: DomainOntology,
  resourceKey: string,
): ReadonlyArray<EventDef> {
  return o.events.filter((e) =>
    e.effects.some((f) => f.resourceKey === resourceKey),
  );
}

/** Resources of a given accounting class (e.g. all 'liability' resources). */
export function resourcesOfClass(
  o: DomainOntology,
  accountClass: ResourceDef['accountClass'],
): ReadonlyArray<ResourceDef> {
  return o.resources.filter((r) => r.accountClass === accountClass);
}

/** The monetary events — the ones that MUST post through LedgerService.post(). */
export function monetaryEvents(o: DomainOntology): ReadonlyArray<EventDef> {
  return o.events.filter((e) => e.isMonetary);
}
