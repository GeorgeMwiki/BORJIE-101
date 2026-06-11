/**
 * Capability registry — the vetted vocabulary a generated tab BINDS to.
 *
 * A render-only tab is inert: its schema says WHAT a widget is but never
 * WHAT IT DOES. The generative fix (see `../types.ts` — `PortalTabWidget.binding`)
 * lets the LLM attach a `binding` to a widget — either a live `query` against
 * a known estate domain, or a `tool` invocation — instead of baking a static
 * snapshot. For that to be safe the LLM must pick the `resource` / `toolId`
 * from a CLOSED, typed set rather than emitting an arbitrary string an
 * attacker (or a hallucinating model) could point at any table or RPC.
 *
 * This module IS that closed set. Each entry carries a stable id + a human
 * label (the label is what the tab-builder UI and the brain's "Why does this
 * exist?" card render). Adding a NEW domain or tool is a one-line registry
 * COMPOSITION here — never a new per-case handler elsewhere. `isKnownResource`
 * / `isKnownTool` are the parse-time guards `types.ts` calls so an unknown
 * binding is rejected exactly the way an unknown widget kind is.
 *
 * The whole module is pure / serializable — no I/O, no DB handles. Resolving a
 * binding to live rows is the consumer's job (the records/query layer); this
 * file only vets the NAME.
 */

// ────────────────────────────────────────────────────────────────────
// Queryable resources — the estate domains a widget can read LIVE.
// ────────────────────────────────────────────────────────────────────

/**
 * The vetted queryable domains. Each name is a stable wire token the LLM
 * emits in a `{ kind: 'query', resource }` binding. The list is deliberately
 * mining-estate-coherent (licences, royalty, workforce, production, …) — a new
 * domain is added by appending one entry, so any future surface is covered by
 * COMPOSITION, never new code.
 */
export const PORTAL_QUERY_RESOURCES = [
  'licences',
  'royalty_returns',
  'employees',
  'production_records',
  'reminders',
  'mining_tasks',
  'marketplace_listings',
  'marketplace_bids',
  'offtake_agreements',
  'treasury_accounts',
  'ledger_entries',
  'compliance_obligations',
  'incidents',
  'shipments',
  'subsidiaries',
  'assets',
  'documents',
  'tab_records',
] as const;

export type PortalQueryResource = (typeof PORTAL_QUERY_RESOURCES)[number];

/** Human label for each queryable resource (UI + provenance cards). */
export const PORTAL_QUERY_RESOURCE_LABELS: Readonly<
  Record<PortalQueryResource, string>
> = {
  licences: 'Mining licences',
  royalty_returns: 'Royalty returns',
  employees: 'Employees',
  production_records: 'Production records',
  reminders: 'Reminders',
  mining_tasks: 'Mining tasks',
  marketplace_listings: 'Marketplace listings',
  marketplace_bids: 'Marketplace bids',
  offtake_agreements: 'Offtake agreements',
  treasury_accounts: 'Treasury accounts',
  ledger_entries: 'Ledger entries',
  compliance_obligations: 'Compliance obligations',
  incidents: 'Incidents',
  shipments: 'Shipments',
  subsidiaries: 'Subsidiaries',
  assets: 'Asset register',
  documents: 'Documents',
  tab_records: 'This tab’s own records',
};

// ────────────────────────────────────────────────────────────────────
// Tools — the vetted side-effecting actions a widget can invoke.
// ────────────────────────────────────────────────────────────────────

/**
 * The vetted tool ids a `{ kind: 'tool', toolId }` binding can target. These
 * are coarse, read-mostly / propose-style actions — sovereign + money rails
 * (LedgerService.post, kill-switch, four-eye) are NEVER exposed here; those go
 * through the policy-gate, not a generated tab. Adding a tool is one entry.
 */
export const PORTAL_TOOL_IDS = [
  'create_reminder',
  'create_mining_task',
  'request_document',
  'export_records',
  'notify_owner',
  'recompute_royalty_estimate',
] as const;

export type PortalToolId = (typeof PORTAL_TOOL_IDS)[number];

/** Human label for each tool id. */
export const PORTAL_TOOL_LABELS: Readonly<Record<PortalToolId, string>> = {
  create_reminder: 'Create a reminder',
  create_mining_task: 'Create a mining task',
  request_document: 'Request a document',
  export_records: 'Export records',
  notify_owner: 'Notify the owner',
  recompute_royalty_estimate: 'Recompute royalty estimate',
};

// ────────────────────────────────────────────────────────────────────
// Guards — the parse-time membership checks `types.ts` consumes.
// ────────────────────────────────────────────────────────────────────

const RESOURCE_SET: ReadonlySet<string> = new Set(PORTAL_QUERY_RESOURCES);
const TOOL_SET: ReadonlySet<string> = new Set(PORTAL_TOOL_IDS);

/** True when `name` is one of the vetted queryable resources. */
export function isKnownResource(name: string): name is PortalQueryResource {
  return RESOURCE_SET.has(name);
}

/** True when `id` is one of the vetted tool ids. */
export function isKnownTool(id: string): id is PortalToolId {
  return TOOL_SET.has(id);
}

/** Human label for a known resource, or `null` for an unknown name. */
export function getResourceLabel(name: string): string | null {
  return isKnownResource(name) ? PORTAL_QUERY_RESOURCE_LABELS[name] : null;
}

/** Human label for a known tool, or `null` for an unknown id. */
export function getToolLabel(id: string): string | null {
  return isKnownTool(id) ? PORTAL_TOOL_LABELS[id] : null;
}
