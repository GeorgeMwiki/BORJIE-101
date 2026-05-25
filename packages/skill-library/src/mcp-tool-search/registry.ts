/**
 * McpToolRegistry — holds MCP tool descriptors across servers, applies
 * the defer-threshold rule, and exposes ToolSearch queries + lazy schema
 * loads.
 */

import type {
  McpToolDescriptor,
  ToolSearchQuery,
  ToolSearchResult,
} from './types.js';
import { DEFAULT_DEFER_THRESHOLD } from './types.js';
import { rankCandidates } from './ranking.js';

export interface McpToolRegistryOptions {
  /**
   * Tool count above which a server's schemas are deferred. Defaults to
   * 50 (matches Claude Code's behavior).
   */
  readonly defer_threshold?: number;
}

export interface ServerToolSet {
  /** Server name (matches `mcp__<server>__*` prefix). */
  readonly server: string;
  /** Tool descriptors for this server. */
  readonly tools: ReadonlyArray<McpToolDescriptor>;
}

export interface ContextProjection {
  /**
   * Full descriptors that go into context as-is (small servers below
   * the defer threshold).
   */
  readonly inlined: ReadonlyArray<McpToolDescriptor>;
  /**
   * Server -> deferred summary. The model sees only the count + a
   * `ToolSearch` surface for these. Schemas load lazily.
   */
  readonly deferred: ReadonlyArray<{
    readonly server: string;
    readonly tool_count: number;
  }>;
  /**
   * Approximate context tokens saved by deferral, given a coarse
   * heuristic of 200 tokens per full schema and 20 per minimal entry.
   * Used for telemetry — not authoritative.
   */
  readonly approx_tokens_saved: number;
}

export class McpToolRegistry {
  private readonly servers = new Map<string, ReadonlyArray<McpToolDescriptor>>();
  private readonly options: Required<McpToolRegistryOptions>;

  constructor(options: McpToolRegistryOptions = {}) {
    this.options = {
      defer_threshold: options.defer_threshold ?? DEFAULT_DEFER_THRESHOLD,
    };
  }

  registerServer(server: string, tools: ReadonlyArray<McpToolDescriptor>): void {
    this.servers.set(server, tools);
  }

  registerAll(sets: ReadonlyArray<ServerToolSet>): void {
    for (const set of sets) this.registerServer(set.server, set.tools);
  }

  /**
   * Produce a context projection — what goes inline vs. what gets
   * deferred. Callers use this to render the system prompt and the
   * ToolSearch surface description.
   */
  projectContext(): ContextProjection {
    const inlined: Array<McpToolDescriptor> = [];
    const deferred: Array<{ server: string; tool_count: number }> = [];
    let saved = 0;
    for (const [server, tools] of this.servers) {
      if (tools.length >= this.options.defer_threshold) {
        deferred.push({ server, tool_count: tools.length });
        // Saved ≈ (full schema cost - minimal cost) per deferred tool.
        saved += tools.length * (200 - 20);
      } else {
        inlined.push(...tools);
      }
    }
    return { inlined, deferred, approx_tokens_saved: saved };
  }

  /**
   * Run a ToolSearch query across deferred servers. Inlined tools are
   * already in context so they're not searched (the model already sees
   * them).
   */
  search(query: ToolSearchQuery): ToolSearchResult {
    const start = performance.now();
    const candidates = this.searchPool(query);
    const elapsed = performance.now() - start;
    return {
      candidates,
      registry_size: this.totalToolCount(),
      elapsed_ms: elapsed,
    };
  }

  /**
   * Load the FULL schema for a specific tool. Throws if not in registry.
   * This is the lazy path the model triggers when it actually wants to
   * call a tool surfaced by ToolSearch.
   */
  loadFullSchema(toolName: string): Readonly<Record<string, unknown>> {
    for (const tools of this.servers.values()) {
      const found = tools.find((t) => t.name === toolName);
      if (found) return found.full_schema;
    }
    throw new Error(`[mcp-tool-search] tool not found in registry: ${toolName}`);
  }

  totalToolCount(): number {
    let n = 0;
    for (const tools of this.servers.values()) n += tools.length;
    return n;
  }

  private searchPool(query: ToolSearchQuery): ReadonlyArray<import('./types.js').ToolSearchCandidate> {
    // Pool = ALL tools across deferred servers. Inlined are not searched
    // because the model already has them.
    const pool: Array<McpToolDescriptor> = [];
    for (const [, tools] of this.servers) {
      if (tools.length >= this.options.defer_threshold) {
        pool.push(...tools);
      }
    }
    let filtered: ReadonlyArray<McpToolDescriptor> = pool;
    if (query.name_filter && query.name_filter.length > 0) {
      const allow = new Set(query.name_filter);
      filtered = pool.filter((t) => allow.has(t.name));
    }
    return rankCandidates(filtered, query.query, query.max_results ?? 5);
  }
}
