/**
 * User-context-store → role-aware-advisor DataPort adapter.
 *
 * The advisor's `DataPort.fetchSnippets({role, tenantId, userId, intent,
 * question, resourceNeeds})` calls return `DataSnippet[]`:
 *   { id, resource, summary, body?, scope, ownedByUser?, tenantId?, data? }
 *
 * The user-context-store's `createUserContextDataPort` returns its own
 * `Snippet[]`:
 *   { source, content, citation: { kind, id, field? }, confidence, timestamp? }
 *
 * This adapter:
 *   1. Maps advisor `Role` → user-context-store `Role` (collapses
 *      hyphenated names to the store's snake-case naming).
 *   2. Calls the store's data port.
 *   3. Translates each `Snippet` back into a `DataSnippet` with a
 *      defensible `resource` (mapped from `citation.kind`), `scope`
 *      (defaults to 'own' since the store only ever returns scoped
 *      data anyway), and `body` derived from `content`.
 *   4. Swallows inner errors so a data-side hiccup never black-holes
 *      the advisor — return `[]` and let the orchestrator answer
 *      without evidence rather than 500.
 */

import {
  createUserContextDataPort,
  type ContextAuditPort,
  type Embedder,
  type InMemoryCorpusIndex,
  type Snippet as UCSSnippet,
  type Role as UCSRole,
} from '@borjie/user-context-store';
import type {
  DataPort,
  DataFetchRequest,
  DataSnippet,
  Role as AdvisorRole,
  ResourceKind,
} from '@borjie/role-aware-advisor';

export interface WireUserContextDataPortOpts {
  /** Drizzle client (or null in degraded mode). */
  readonly db: unknown | null;
  /** Embedder for scoped semantic search. */
  readonly embedder: Embedder;
  /** Audit sink for fetch-records. Usually `nullAuditSink`. */
  readonly audit: ContextAuditPort;
  /** Pre-seeded corpus index (empty in degraded mode). */
  readonly index: InMemoryCorpusIndex;
}

// ───────────────────────────────────────────────────────────────────
// Role mapping
// ───────────────────────────────────────────────────────────────────

/**
 * Map the advisor's role enum to the user-context-store role enum.
 * Returns null when the store does not support the inbound role
 * (e.g. `service-provider`) — caller should return `[]` in that case.
 */
function mapRole(advisorRole: AdvisorRole): UCSRole | null {
  switch (advisorRole) {
    case 'tenant':
      return 'tenant';
    case 'owner':
      return 'owner';
    case 'property-manager':
      return 'pm';
    case 'estate-manager':
      return 'estate_mgr';
    case 'admin':
      return 'admin';
    case 'prospect':
      return 'prospect';
    case 'service-provider':
      return null;
    default:
      return null;
  }
}

// ───────────────────────────────────────────────────────────────────
// Snippet shape translation
// ───────────────────────────────────────────────────────────────────

/**
 * Map a user-context-store citation kind onto the advisor's
 * `ResourceKind` taxonomy. Falls back to `'building-public-info'` for
 * unknown citation kinds — the guard will keep them visible to every
 * role rather than risk denying useful context.
 */
function mapCitationKindToResource(kind: string, role: AdvisorRole): ResourceKind {
  switch (kind) {
    case 'lease':
      return 'own-lease';
    case 'unit':
      return 'own-unit';
    case 'maintenance':
      return 'own-maintenance';
    case 'invoice':
    case 'payment':
      return 'own-payment-history';
    case 'utility_bill':
      return 'own-payment-history';
    case 'property':
      return role === 'owner' ? 'owned-properties' : 'building-public-info';
    case 'document':
    case 'communication':
    case 'profile':
    case 'signal':
    case 'trigger':
      return role === 'owner' ? 'owned-properties' : 'building-public-info';
    case 'lead':
      return 'public-listing';
    default:
      return 'building-public-info';
  }
}

/**
 * Translate one user-context-store `Snippet` into the advisor's
 * `DataSnippet`. The advisor's guard will accept/redact/deny based on
 * `scope` + `tenantId` + `ownedByUser` — we set `scope='own'` because
 * the store's port only returns scoped data, and copy the user/tenant
 * pair so the cross-tenant fence holds.
 */
function snippetToDataSnippet(
  snippet: UCSSnippet,
  role: AdvisorRole,
  tenantId: string,
  userId: string,
): DataSnippet {
  const resource = mapCitationKindToResource(snippet.citation.kind, role);
  return {
    id: snippet.citation.id || `snip-${snippet.source.slice(0, 32)}`,
    resource,
    summary: snippet.source,
    body: snippet.content,
    scope: 'own',
    ownedByUser: true,
    tenantId,
    data: {
      content: snippet.content,
      ...(snippet.timestamp ? { timestamp: snippet.timestamp } : {}),
      citationField: snippet.citation.field,
      userId,
    },
  } as DataSnippet;
}

// ───────────────────────────────────────────────────────────────────
// Factory
// ───────────────────────────────────────────────────────────────────

/**
 * Build a role-aware-advisor `DataPort` backed by the
 * user-context-store. Never throws on construction — operates in
 * "best-effort" mode: any inner error inside `fetchSnippets` is
 * swallowed and an empty array is returned so the advisor can still
 * answer (without evidence).
 */
export function wireUserContextDataPort(opts: WireUserContextDataPortOpts): DataPort {
  const inner = createUserContextDataPort({
    db: opts.db,
    embedder: opts.embedder,
    audit: opts.audit,
    index: opts.index,
  });

  return {
    async fetchSnippets(req: DataFetchRequest): Promise<ReadonlyArray<DataSnippet>> {
      const ucsRole = mapRole(req.role);
      if (!ucsRole) {
        // service-provider or unknown — no user-context store backing.
        return [];
      }
      try {
        const snippets = await inner.fetchSnippets({
          role: ucsRole,
          tenantId: req.tenantId,
          userId: req.userId,
          intent: req.intent,
          question: req.question,
        });
        return snippets.map((s) =>
          snippetToDataSnippet(s, req.role, req.tenantId, req.userId),
        );
      } catch {
        // Never let a data-side error black-hole the advisor.
        return [];
      }
    },
  };
}
