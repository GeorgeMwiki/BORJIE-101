/**
 * Progressive-disclosure view over the deployable Borjie tool registry.
 *
 * The mount-everything lane wires `@borjie/mcp`'s tools-as-/proc-filesystem
 * loader across every mounted organ. This module makes the deployable
 * `@borjie/mcp-server` surface a first-class participant: it exposes
 * `BORJIE_TOOLS` as a cheap name catalogue (the `ls`) plus a per-tool
 * full-spec `describe` (the `cat`), so a host that mounts this server pages
 * in only the tool specs a turn needs instead of the whole registry.
 *
 * Pure + additive: reads the existing `BORJIE_TOOLS` declarations and the
 * tier/scope metadata already on each descriptor. No wire-protocol change.
 */

import { BORJIE_TOOLS, findToolDefinition } from './tool-registry.js';
import type { McpScope, McpTier, McpToolDefinition } from './types.js';

/** A cheap catalogue entry — name + the metadata a router needs to gate. */
export interface ToolCatalogEntry {
  readonly name: string;
  readonly minimumTier: McpTier;
  readonly requiredScopes: ReadonlyArray<McpScope>;
  readonly estimatedCostUsdMicro: number;
}

/** The full, paged-in spec for one tool (the expensive payload). */
export interface ToolFullSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly requiredInputs: ReadonlyArray<string>;
  readonly minimumTier: McpTier;
  readonly requiredScopes: ReadonlyArray<McpScope>;
  readonly estimatedCostUsdMicro: number;
}

function toCatalogEntry(def: McpToolDefinition): ToolCatalogEntry {
  return Object.freeze({
    name: def.name,
    minimumTier: def.minimumTier,
    requiredScopes: def.requiredScopes,
    estimatedCostUsdMicro: def.estimatedCostUsdMicro,
  });
}

function toFullSpec(def: McpToolDefinition): ToolFullSpec {
  return Object.freeze({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema as Readonly<Record<string, unknown>>,
    requiredInputs: def.requiredInputs,
    minimumTier: def.minimumTier,
    requiredScopes: def.requiredScopes,
    estimatedCostUsdMicro: def.estimatedCostUsdMicro,
  });
}

/**
 * `ls` — the cheap catalogue: tool names + gating metadata, no schemas.
 * Optionally scoped to a tier so a `standard` caller never sees `enterprise`
 * tool names it cannot reach.
 */
export function listToolCatalog(
  opts?: { readonly maxTier?: McpTier },
): ReadonlyArray<ToolCatalogEntry> {
  const order: ReadonlyArray<McpTier> = ['standard', 'pro', 'enterprise'];
  const ceiling = opts?.maxTier ? order.indexOf(opts.maxTier) : order.length - 1;
  return Object.freeze(
    BORJIE_TOOLS.filter(
      (t) => order.indexOf(t.minimumTier) <= ceiling,
    ).map(toCatalogEntry),
  );
}

/**
 * `cat` — page in the FULL specs for only the requested tool names. Unknown
 * names are silently skipped (the catalogue is the source of truth for what
 * exists; a caller may pass a stale name).
 */
export function describeTools(
  names: ReadonlyArray<string>,
): ReadonlyArray<ToolFullSpec> {
  const out: Array<ToolFullSpec> = [];
  for (const name of names) {
    const def = findToolDefinition(name);
    if (def) out.push(toFullSpec(def));
  }
  return Object.freeze(out);
}
