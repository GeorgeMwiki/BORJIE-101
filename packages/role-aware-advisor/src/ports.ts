/**
 * External ports — caller injects implementations. Each port is a
 * minimal structural interface; we deliberately avoid depending on
 * `@borjie/ai-copilot` etc. so this package stays trivially
 * portable.
 */

import type { Role, ResourceKind } from './roles.js';
import type { Intent } from './router.js';

// ─── Brain port ───────────────────────────────────────────────────

export interface BrainCitation {
  readonly id: string;
  /** Short label for the UI footnote. */
  readonly label: string;
  /** Free-form source identifier (URL, doc id, snippet id, ...). */
  readonly source: string;
}

export interface BrainResponse {
  readonly text: string;
  readonly citations: ReadonlyArray<BrainCitation>;
}

export interface BrainRequest {
  /** Concatenated persona + sub-advisor system prompts. */
  readonly systemPrompt: string;
  /** The user's verbatim question. */
  readonly question: string;
  /** Pre-filtered, pre-redacted snippets the brain may quote from. */
  readonly contextSnippets: ReadonlyArray<{
    readonly id: string;
    readonly resource: ResourceKind;
    readonly summary: string;
    readonly body?: string;
  }>;
  /** Rough output ceiling — orchestrator translates persona.defaultDepth. */
  readonly maxTokens?: number;
}

export interface BrainPort {
  respond(req: BrainRequest): Promise<BrainResponse>;
}

// ─── Data port ────────────────────────────────────────────────────

export interface DataSnippet {
  readonly id: string;
  readonly resource: ResourceKind;
  readonly summary: string;
  readonly body?: string;
  /** `'own' | 'tenant-wide' | 'cross-tenant' | 'public'`. */
  readonly scope: 'own' | 'tenant-wide' | 'cross-tenant' | 'public';
  readonly ownedByUser?: boolean;
  /** Tenant the snippet belongs to — guard drops mismatched values. */
  readonly tenantId?: string;
  /** Full original record — used for PII redaction. */
  readonly data?: Record<string, unknown>;
}

export interface DataFetchRequest {
  readonly role: Role;
  readonly tenantId: string;
  readonly userId: string;
  readonly intent: Intent;
  readonly question: string;
  /** Resource kinds the orchestrator decided this intent needs. */
  readonly resourceNeeds: ReadonlyArray<ResourceKind>;
}

export interface DataPort {
  fetchSnippets(req: DataFetchRequest): Promise<ReadonlyArray<DataSnippet>>;
}

// ─── In-memory test/dev doubles ───────────────────────────────────

/**
 * Echo brain — returns a deterministic response based on its inputs.
 * Useful for tests so we don't have to mock per call site.
 *
 * The renderer pastes the FULL system prompt verbatim so tests can
 * assert on persona-specific copy (the persona is the only handle a
 * caller has into "did the right role-flavoured prompt get sent").
 */
export function createEchoBrain(): BrainPort {
  return {
    async respond(req) {
      const citations: BrainCitation[] = req.contextSnippets.map((s) => ({
        id: s.id,
        label: s.summary.slice(0, 60),
        source: `snippet:${s.id}`,
      }));
      const body =
        req.contextSnippets.length === 0
          ? `[echo] no evidence available; answering: ${req.question}`
          : `[echo] ${req.question}\n\nEvidence: ${req.contextSnippets
              .map((s) => `- ${s.summary}`)
              .join('\n')}`;
      return {
        text: `<persona>\n${req.systemPrompt}\n</persona>\n\n${body}`,
        citations,
      };
    },
  };
}

/**
 * Static data port — returns a fixed list of snippets. Tests build
 * one per scenario; production wires the real RAG-backed port.
 */
export function createStaticDataPort(
  snippets: ReadonlyArray<DataSnippet>,
): DataPort {
  return {
    async fetchSnippets() {
      return snippets;
    },
  };
}
