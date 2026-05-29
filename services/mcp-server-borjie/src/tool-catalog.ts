/**
 * Public-facing MCP tool catalog.
 *
 * Each entry mirrors a brain tool that already exists in the api-gateway
 * brain-tools composition (owned by sibling agents). We deliberately do
 * NOT import the brain-tools package here — that would couple the public
 * MCP surface to the internal kernel and force a redeploy of this service
 * every time a brain tool changes. Instead we publish a curated, stable
 * tool catalog: each entry has a name, a description, a JSON schema, the
 * required scopes, and the stakes tier. The handler dispatches by HTTP
 * to the corresponding `/api/v1/...` route exposed by api-gateway, which
 * in turn invokes the same brain-tool the home chat calls.
 *
 * This separation lets us:
 *   - Document a stable public catalog (versioned, semver-disciplined)
 *     without leaking internal kernel churn.
 *   - Enforce scope-narrowing here without re-implementing it in every
 *     brain-tool descriptor.
 *   - Render `tools/list` with bilingual descriptions even when the
 *     underlying brain tool has English-only descriptions internally.
 */

import type { BorjieMcpToolDescriptor } from './types.js';

const obj = <T>(v: T): T => Object.freeze(v) as T;
const arr = <T>(v: ReadonlyArray<T>): ReadonlyArray<T> => Object.freeze(v);

// ─────────────────────────────────────────────────────────────────────
// mining.drafts.* — draft composition + lock
// ─────────────────────────────────────────────────────────────────────

const draftsComposeFreeForm: BorjieMcpToolDescriptor = obj({
  name: 'mining_drafts_compose_free_form',
  description:
    'Compose a free-form draft (memo, contract clause, letter, report section). Returns a draft id and the first revision content. Bilingual sw / en. Sw default.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      intent: obj({
        type: 'string' as const,
        description: 'Plain-language intent ("draft a 30-day NDA for X").',
      }),
      locale: obj({
        type: 'string' as const,
        enum: arr(['sw', 'en']),
        description: 'Target locale (default sw).',
      }),
      format: obj({
        type: 'string' as const,
        enum: arr(['markdown', 'pdf', 'docx']),
        description: 'Output format (default markdown).',
      }),
    }),
    required: arr(['intent']),
  }),
  requiredScopes: arr(['owner:draft']),
  stakes: 'MEDIUM',
  isWrite: true,
  requiresConfirmation: false,
});

const draftsList: BorjieMcpToolDescriptor = obj({
  name: 'mining_drafts_list',
  description:
    'List the owner s drafts with pagination. Includes lock status and last revision summary.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      cursor: obj({ type: 'string' as const }),
      limit: obj({ type: 'number' as const }),
    }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const draftsView: BorjieMcpToolDescriptor = obj({
  name: 'mining_drafts_view',
  description: 'View a single draft with all its revisions and lock status.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({ id: obj({ type: 'string' as const }) }),
    required: arr(['id']),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const draftsLock: BorjieMcpToolDescriptor = obj({
  name: 'mining_drafts_lock',
  description:
    'Lock a draft revision making it immutable. Requires confirmation.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      revisionId: obj({ type: 'string' as const }),
      reason: obj({ type: 'string' as const }),
    }),
    required: arr(['revisionId']),
  }),
  requiredScopes: arr(['owner:draft']),
  stakes: 'HIGH',
  isWrite: true,
  requiresConfirmation: true,
});

// ─────────────────────────────────────────────────────────────────────
// mining.media.* — media generation
// ─────────────────────────────────────────────────────────────────────

const mediaGenerate: BorjieMcpToolDescriptor = obj({
  name: 'mining_media_generate',
  description:
    'Generate a media artefact (chart, image, infographic) tied to an entity.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      entityRef: obj({ type: 'string' as const }),
      kind: obj({
        type: 'string' as const,
        enum: arr(['chart', 'image', 'infographic']),
      }),
      prompt: obj({ type: 'string' as const }),
    }),
    required: arr(['kind', 'prompt']),
  }),
  requiredScopes: arr(['owner:write']),
  stakes: 'MEDIUM',
  isWrite: true,
  requiresConfirmation: false,
});

// ─────────────────────────────────────────────────────────────────────
// mining.ui.* — tab spawning, pinning
// ─────────────────────────────────────────────────────────────────────

const uiTabsList: BorjieMcpToolDescriptor = obj({
  name: 'mining_ui_tabs_list',
  description: 'List the owner s open cockpit tabs.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const uiTabsSpawn: BorjieMcpToolDescriptor = obj({
  name: 'mining_ui_tabs_spawn',
  description: 'Spawn a new cockpit tab of a given kind.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      kind: obj({ type: 'string' as const }),
      params: obj({ type: 'object' as const }),
    }),
    required: arr(['kind']),
  }),
  requiredScopes: arr(['owner:reminders']),
  stakes: 'LOW',
  isWrite: true,
  requiresConfirmation: false,
});

// ─────────────────────────────────────────────────────────────────────
// mining.opportunities.* + mining.risks.*
// ─────────────────────────────────────────────────────────────────────

const opportunitiesScan: BorjieMcpToolDescriptor = obj({
  name: 'mining_opportunities_scan',
  description:
    'Scan the estate for opportunities (price-arbitrage, buyer-fit, settlement timing).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({ scope: obj({ type: 'string' as const }) }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const risksScan: BorjieMcpToolDescriptor = obj({
  name: 'mining_risks_scan',
  description:
    'Scan the estate for risks (compliance, financial, safety, geological).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({ scope: obj({ type: 'string' as const }) }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

// ─────────────────────────────────────────────────────────────────────
// mining.calibration.* + decisions.* + entity.*
// ─────────────────────────────────────────────────────────────────────

const calibrationStatus: BorjieMcpToolDescriptor = obj({
  name: 'mining_calibration_status',
  description:
    'Read the calibration monitor s current state (over- / under-confidence per persona).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const decisionsList: BorjieMcpToolDescriptor = obj({
  name: 'decisions_list',
  description:
    'List recent decision-journal entries with their retrospection ratings.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      since: obj({ type: 'string' as const, format: 'date-time' }),
      limit: obj({ type: 'number' as const }),
    }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const decisionsCreate: BorjieMcpToolDescriptor = obj({
  name: 'decisions_create',
  description:
    'Log a decision in the journal. Optional `expectedOutcome` powers the 24h retrospective worker.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      title: obj({ type: 'string' as const }),
      rationale: obj({ type: 'string' as const }),
      expectedOutcome: obj({ type: 'string' as const }),
      stakes: obj({
        type: 'string' as const,
        enum: arr(['LOW', 'MEDIUM', 'HIGH']),
      }),
    }),
    required: arr(['title', 'rationale']),
  }),
  requiredScopes: arr(['owner:write']),
  stakes: 'MEDIUM',
  isWrite: true,
  requiresConfirmation: false,
});

const entityIndexSummary: BorjieMcpToolDescriptor = obj({
  name: 'entity_index_summary',
  description:
    'Return a compact summary of the owner s estate entities (sites, scopes, licences, buyers). Repomap-equivalent.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

// ─────────────────────────────────────────────────────────────────────
// scope.* + md.* + mining.marketplace.* + workforce + geology + production
// ─────────────────────────────────────────────────────────────────────

const scopeNodesList: BorjieMcpToolDescriptor = obj({
  name: 'scope_nodes_list',
  description: 'List the owner s scope nodes (sites, plots, pits, processing).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const scopeNodesCreate: BorjieMcpToolDescriptor = obj({
  name: 'scope_nodes_create',
  description: 'Create a new scope node attached to an existing parent.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      name: obj({ type: 'string' as const }),
      kind: obj({
        type: 'string' as const,
        enum: arr(['site', 'plot', 'pit', 'processing']),
      }),
      parentId: obj({ type: 'string' as const }),
    }),
    required: arr(['name', 'kind']),
  }),
  requiredScopes: arr(['owner:write']),
  stakes: 'MEDIUM',
  isWrite: true,
  requiresConfirmation: false,
});

const mdDailyBrief: BorjieMcpToolDescriptor = obj({
  name: 'md_daily_brief',
  description:
    'Read Mr. Mwikila s daily brief — production, cash, incident, licence countdown.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      asOfDate: obj({ type: 'string' as const, format: 'date' }),
      locale: obj({ type: 'string' as const, enum: arr(['sw', 'en']) }),
    }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const marketplaceListings: BorjieMcpToolDescriptor = obj({
  name: 'mining_marketplace_listings',
  description: 'List buyer-facing marketplace listings for the owner s estate.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const workforceList: BorjieMcpToolDescriptor = obj({
  name: 'mining_workforce_list',
  description:
    'List active workforce members with their roles and certifications.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({ scope: obj({ type: 'string' as const }) }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const geologySamples: BorjieMcpToolDescriptor = obj({
  name: 'mining_geology_samples',
  description: 'List geology samples captured for the owner s scopes.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({ scopeId: obj({ type: 'string' as const }) }),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const productionToday: BorjieMcpToolDescriptor = obj({
  name: 'mining_production_today',
  description:
    'Today s production summary (tonnes, grade, recovery, dispatched units).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const cooperativesList: BorjieMcpToolDescriptor = obj({
  name: 'mining_cooperatives_list',
  description: 'List cooperative settlements (incoming and outgoing).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const insurancePolicies: BorjieMcpToolDescriptor = obj({
  name: 'mining_insurance_policies',
  description: 'List active insurance policies covering the estate.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const messagingThreads: BorjieMcpToolDescriptor = obj({
  name: 'owner_messaging_threads',
  description: 'List the owner s active messaging threads.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const complianceStatus: BorjieMcpToolDescriptor = obj({
  name: 'compliance_status',
  description:
    'Read the compliance posture (PCCB / PDPA / FAR) for the owner s estate.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const estateNetWorth: BorjieMcpToolDescriptor = obj({
  name: 'estate_net_worth',
  description:
    'Read the estate-wide net-worth snapshot (assets, liabilities, equity, currency mix).',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const shareLinkCreate: BorjieMcpToolDescriptor = obj({
  name: 'estate_share_link_create',
  description:
    'Generate a time-boxed share link for an entity. Returns the URL and expiry.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      entityRef: obj({ type: 'string' as const }),
      hours: obj({ type: 'number' as const }),
      recipientEmail: obj({ type: 'string' as const }),
    }),
    required: arr(['entityRef']),
  }),
  requiredScopes: arr(['owner:share']),
  stakes: 'MEDIUM',
  isWrite: true,
  requiresConfirmation: false,
});

const remindersList: BorjieMcpToolDescriptor = obj({
  name: 'reminders_list',
  description: 'List the owner s active reminders.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:read']),
  stakes: 'LOW',
  isWrite: false,
  requiresConfirmation: false,
});

const remindersCreate: BorjieMcpToolDescriptor = obj({
  name: 'reminders_create',
  description: 'Create a reminder firing at a specific time.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({
      at: obj({ type: 'string' as const, format: 'date-time' }),
      body: obj({ type: 'string' as const }),
    }),
    required: arr(['at', 'body']),
  }),
  requiredScopes: arr(['owner:reminders']),
  stakes: 'LOW',
  isWrite: true,
  requiresConfirmation: false,
});

const undoLast: BorjieMcpToolDescriptor = obj({
  name: 'owner_undo_last',
  description: 'Undo the most recent action within the undo window.',
  inputSchema: obj({
    type: 'object' as const,
    properties: obj({}),
    required: arr([]),
  }),
  requiredScopes: arr(['owner:write']),
  stakes: 'HIGH',
  isWrite: true,
  requiresConfirmation: true,
});

export const BORJIE_PUBLIC_MCP_TOOLS: ReadonlyArray<BorjieMcpToolDescriptor> =
  Object.freeze([
    draftsComposeFreeForm,
    draftsList,
    draftsView,
    draftsLock,
    mediaGenerate,
    uiTabsList,
    uiTabsSpawn,
    opportunitiesScan,
    risksScan,
    calibrationStatus,
    decisionsList,
    decisionsCreate,
    entityIndexSummary,
    scopeNodesList,
    scopeNodesCreate,
    mdDailyBrief,
    marketplaceListings,
    workforceList,
    geologySamples,
    productionToday,
    cooperativesList,
    insurancePolicies,
    messagingThreads,
    complianceStatus,
    estateNetWorth,
    shareLinkCreate,
    remindersList,
    remindersCreate,
    undoLast,
  ]);

export function findPublicTool(
  name: string,
): BorjieMcpToolDescriptor | undefined {
  return BORJIE_PUBLIC_MCP_TOOLS.find((t) => t.name === name);
}
