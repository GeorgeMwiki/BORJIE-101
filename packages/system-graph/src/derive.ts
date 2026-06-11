/**
 * @borjie/system-graph — derivation sources.
 *
 * Pure derivation functions, one per substrate. Each takes a manifest
 * (the structured output of an FS/DB walker that lives in the
 * consolidation-worker) and returns a `GraphFragment`. The functions are
 * pure over their input so the package tests with hand-built fixtures and
 * never imports the FS, the DB, or any heavy package.
 *
 * Substrates (per MD_AS_BODY_ARCHITECTURE.md §bodyModel DERIVATION):
 *   - route manifests (`*.hono.ts`)          -> service + screen edges
 *   - screen registries (owner-os-tabs, …)    -> screen nodes
 *   - package exports                          -> package nodes + depends_on
 *   - Drizzle schemas (database/schemas)       -> schema nodes + flows_data_to
 *   - MCP discovery output                     -> mcp nodes + exposes
 *   - capability-catalogue registry            -> capability nodes + governed_by
 *   - sub-MD / junior registry                 -> junior nodes + serves
 */

import type {
  EdgeCandidate,
  GraphFragment,
  NodeCandidate,
  SystemEdgeType,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Manifest input shapes — what the FS/DB walkers emit.
// ─────────────────────────────────────────────────────────────────────

export interface RouteManifestEntry {
  /** Service that owns the route, e.g. `api-gateway`. */
  readonly service: string;
  /** Route group, e.g. `mining/bids`. */
  readonly group: string;
  /** HTTP method + path, e.g. `GET /bids/:id`. */
  readonly route: string;
}

export interface ScreenManifestEntry {
  /** Surface the screen renders on, e.g. `owner-web`. */
  readonly surface: string;
  /** Screen / tab id, e.g. `royalties`. */
  readonly screen: string;
  readonly label: string;
}

export interface PackageManifestEntry {
  /** Package name, e.g. `@borjie/central-intelligence`. */
  readonly name: string;
  /** Workspace deps (`@borjie/*`) this package depends on. */
  readonly deps: ReadonlyArray<string>;
}

export interface SchemaManifestEntry {
  /** Table name, e.g. `marketplace_bids`. */
  readonly table: string;
  /** Schema file the table is declared in. */
  readonly file: string;
}

export interface McpManifestEntry {
  /** MCP server / tool id, e.g. `mining.bids.list`. */
  readonly tool: string;
  /** Service that exposes it, e.g. `api-gateway`. */
  readonly service: string;
}

export interface CapabilityManifestEntry {
  /** Capability id, e.g. `offtake-settlement`. */
  readonly id: string;
  readonly label: string;
  /** Lifecycle, e.g. `live` / `shadow` / `draft`. */
  readonly lifecycle: string;
  /** Rail / gate that governs it, e.g. `four_eye`. Optional. */
  readonly governedBy?: string;
}

export interface JuniorManifestEntry {
  /** Junior / sub-MD id, e.g. `metallurgy-agent`. */
  readonly id: string;
  readonly label: string;
  /** Capability ids this junior serves. */
  readonly serves: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — stable, namespaced node ids.
// ─────────────────────────────────────────────────────────────────────

const nid = {
  org: () => 'org:borjie',
  surface: (s: string) => `surface:${s}`,
  screen: (surface: string, screen: string) => `screen:${surface}/${screen}`,
  service: (s: string) => `service:${s}`,
  pkg: (p: string) => `package:${p}`,
  schema: (t: string) => `schema:${t}`,
  mcp: (t: string) => `mcp:${t}`,
  capability: (c: string) => `capability:${c}`,
  junior: (j: string) => `junior:${j}`,
};

function edge(
  srcId: string,
  edgeType: SystemEdgeType,
  dstId: string,
): EdgeCandidate {
  return { srcId, dstId, edgeType };
}

// ─────────────────────────────────────────────────────────────────────
// LAYER 0 — the self.
// ─────────────────────────────────────────────────────────────────────

export function deriveSelf(): GraphFragment {
  return {
    nodes: [
      {
        id: nid.org(),
        kind: 'org',
        label: 'Borjie (the OS)',
        summary: 'The MD-as-body operating system — the self these organs compose.',
        derivedFrom: 'self',
      },
    ],
    edges: [],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Routes -> services (+ the route flows data to the gateway).
// ─────────────────────────────────────────────────────────────────────

export function deriveRoutes(
  entries: ReadonlyArray<RouteManifestEntry>,
): GraphFragment {
  const nodes = new Map<string, NodeCandidate>();
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    const svcId = nid.service(e.service);
    if (!nodes.has(svcId)) {
      nodes.set(svcId, {
        id: svcId,
        kind: 'service',
        label: e.service,
        summary: `Service exposing Hono routes (e.g. ${e.group}).`,
        derivedFrom: 'routes',
      });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────────────
// Screens -> surfaces.
// ─────────────────────────────────────────────────────────────────────

export function deriveScreens(
  entries: ReadonlyArray<ScreenManifestEntry>,
): GraphFragment {
  const nodes = new Map<string, NodeCandidate>();
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    const surfId = nid.surface(e.surface);
    const scrId = nid.screen(e.surface, e.screen);
    if (!nodes.has(surfId)) {
      nodes.set(surfId, {
        id: surfId,
        kind: 'surface',
        label: e.surface,
        summary: `Product surface (${e.surface}).`,
        derivedFrom: 'screens',
      });
    }
    nodes.set(scrId, {
      id: scrId,
      kind: 'screen',
      label: e.label,
      summary: `Screen "${e.label}" on ${e.surface}.`,
      derivedFrom: 'screens',
    });
    edges.push(edge(scrId, 'renders_on', surfId));
  }
  return { nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────────────
// Packages -> depends_on.
// ─────────────────────────────────────────────────────────────────────

export function derivePackages(
  entries: ReadonlyArray<PackageManifestEntry>,
): GraphFragment {
  const nodes = new Map<string, NodeCandidate>();
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    const pkgId = nid.pkg(e.name);
    nodes.set(pkgId, {
      id: pkgId,
      kind: 'package',
      label: e.name,
      summary: `Workspace package ${e.name}.`,
      derivedFrom: 'packages',
    });
  }
  for (const e of entries) {
    const pkgId = nid.pkg(e.name);
    for (const dep of e.deps) {
      const depId = nid.pkg(dep);
      if (nodes.has(depId)) edges.push(edge(pkgId, 'depends_on', depId));
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────────────
// Schemas -> data tables.
// ─────────────────────────────────────────────────────────────────────

export function deriveSchemas(
  entries: ReadonlyArray<SchemaManifestEntry>,
): GraphFragment {
  const nodes = new Map<string, NodeCandidate>();
  for (const e of entries) {
    const tblId = nid.schema(e.table);
    nodes.set(tblId, {
      id: tblId,
      kind: 'schema',
      label: e.table,
      summary: `Data table ${e.table} (${e.file}).`,
      derivedFrom: 'schemas',
    });
  }
  return { nodes: [...nodes.values()], edges: [] };
}

// ─────────────────────────────────────────────────────────────────────
// MCP tools -> service exposes tool.
// ─────────────────────────────────────────────────────────────────────

export function deriveMcpTools(
  entries: ReadonlyArray<McpManifestEntry>,
): GraphFragment {
  const nodes = new Map<string, NodeCandidate>();
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    const toolId = nid.mcp(e.tool);
    const svcId = nid.service(e.service);
    nodes.set(toolId, {
      id: toolId,
      kind: 'mcp',
      label: e.tool,
      summary: `MCP tool ${e.tool} exposed by ${e.service}.`,
      derivedFrom: 'mcp',
    });
    if (!nodes.has(svcId)) {
      nodes.set(svcId, {
        id: svcId,
        kind: 'service',
        label: e.service,
        summary: `Service ${e.service}.`,
        derivedFrom: 'mcp',
      });
    }
    edges.push(edge(svcId, 'exposes', toolId));
  }
  return { nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────────────
// Capabilities -> governed_by (rails). Only LIVE/SHADOW capabilities are
// part of the advertised body — draft ones are not yet limbs.
// ─────────────────────────────────────────────────────────────────────

export function deriveCapabilities(
  entries: ReadonlyArray<CapabilityManifestEntry>,
): GraphFragment {
  const nodes: NodeCandidate[] = [];
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    if (e.lifecycle === 'draft' || e.lifecycle === 'deprecated') continue;
    const capId = nid.capability(e.id);
    nodes.push({
      id: capId,
      kind: 'capability',
      label: e.label,
      summary: `Capability ${e.label} (${e.lifecycle}).`,
      derivedFrom: 'capabilities',
    });
    if (e.governedBy) {
      // The rail is modelled as a governed_by edge to a synthetic rail
      // node so the meta-rail / governance lane can reason over it.
      const railId = `rail:${e.governedBy}`;
      nodes.push({
        id: railId,
        kind: 'package',
        label: `rail:${e.governedBy}`,
        summary: `Governance rail ${e.governedBy}.`,
        derivedFrom: 'capabilities',
      });
      edges.push(edge(capId, 'governed_by', railId));
    }
  }
  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────
// Juniors -> serves capability.
// ─────────────────────────────────────────────────────────────────────

export function deriveJuniors(
  entries: ReadonlyArray<JuniorManifestEntry>,
): GraphFragment {
  const nodes: NodeCandidate[] = [];
  const edges: EdgeCandidate[] = [];
  for (const e of entries) {
    const jId = nid.junior(e.id);
    nodes.push({
      id: jId,
      kind: 'junior',
      label: e.label,
      summary: `Sub-MD / junior ${e.label}.`,
      derivedFrom: 'juniors',
    });
    for (const cap of e.serves) {
      edges.push(edge(jId, 'serves', nid.capability(cap)));
    }
  }
  return { nodes, edges };
}

export { nid as systemNodeIds };
