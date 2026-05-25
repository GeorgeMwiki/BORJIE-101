/**
 * MCP ToolSearch — closes R1 gap #9.
 *
 * Problem: every MCP server's tool definitions go into the model context
 * on every request. For BORJIE's tenant integrations (Stripe, M-Pesa,
 * Yodlee, KRA, RGS, NEMA, BRELA, NSSF, NHIF...) that's a context-budget
 * cliff. R1 §B.3 calls it out: "MCP schemas deferred by default via
 * ToolSearch".
 *
 * Solution: when a server reports 50+ tools (THRESHOLD), we replace its
 * FULL schemas in context with a single `mcp_tool_search` surface plus
 * minimal descriptors (name + one-line description). The model invokes
 * `ToolSearch.query("send M-Pesa to phone")` → we return ranked candidates
 * with minimal-schema; the FULL schema is loaded only when the model
 * actually calls one of those tools.
 *
 * Cuts initial context bloat by ~80% for big MCP catalogs.
 */

/**
 * A tool descriptor from an MCP server. The `full_schema` is the JSON
 * Schema for the tool's input — what consumes context.
 */
export interface McpToolDescriptor {
  /** Fully-qualified tool name, e.g. `mcp__mpesa__send`. */
  readonly name: string;
  /** One-line description (always included in context). */
  readonly description: string;
  /**
   * Optional tags used for ranking. e.g. `["payment", "mpesa", "send"]`.
   * Pulled from the MCP `annotations` or inferred from description.
   */
  readonly tags?: ReadonlyArray<string>;
  /**
   * Full JSON Schema for the tool's input. Held by the registry; NOT
   * included in context until the caller invokes
   * `loadFullSchema(name)`.
   */
  readonly full_schema: Readonly<Record<string, unknown>>;
}

/**
 * Minimal-schema view returned by a ToolSearch query. The model sees this
 * + the full description so it can DECIDE to call the tool; the full
 * JSON Schema loads only when the model actually calls it.
 */
export interface ToolSearchCandidate {
  readonly name: string;
  readonly description: string;
  /**
   * Ranking score in [0, 1]. Higher is better. Computed by
   * `rankCandidates` from query keyword overlap.
   */
  readonly score: number;
  /**
   * Minimal-schema hint: top-level input keys + their JSON types,
   * nothing nested. ~10x cheaper than the full schema.
   */
  readonly minimal_schema: ReadonlyArray<{
    readonly key: string;
    readonly type: string;
    readonly required: boolean;
  }>;
}

export interface ToolSearchQuery {
  /** Free-text query. */
  readonly query: string;
  /** Max candidates to return (default 5). */
  readonly max_results?: number;
  /**
   * Optional substring filter on tool name — used for `select:Tool1,Tool2`
   * exact-name selection (mirrors the Claude Code ToolSearch query
   * grammar).
   */
  readonly name_filter?: ReadonlyArray<string>;
}

export interface ToolSearchResult {
  readonly candidates: ReadonlyArray<ToolSearchCandidate>;
  /** Total tools in the registry (for telemetry). */
  readonly registry_size: number;
  /** Latency budget in ms — set when the caller measures. */
  readonly elapsed_ms?: number;
}

/**
 * Default threshold above which a server's tools are deferred.
 * Configurable per-server via `McpToolRegistryOptions.defer_threshold`.
 */
export const DEFAULT_DEFER_THRESHOLD = 50 as const;
