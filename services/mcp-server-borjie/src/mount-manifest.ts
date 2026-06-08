/**
 * Mount manifest — declares THIS public MCP service as a mountable organ the
 * single MD owns, and exposes its public tool catalog through the
 * code-execution-with-MCP progressive-disclosure shape.
 *
 * The MD-as-Body capstone (lane "Mount every Borjie+BN service as an MCP
 * server the one MD owns") needs every service to advertise itself in a
 * uniform, registry-ready form so the central MD can mount it as an organ and
 * page in its tool specs on demand. We deliberately do NOT import
 * `@borjie/mcp` here — same separation rationale as `tool-catalog.ts`: the
 * public service must not couple its deploy cadence to the package's internal
 * churn. Instead it emits a structurally-compatible descriptor (the consumer
 * — the MD's mount registry — adapts it to a live factory at wiring time).
 *
 * Progressive disclosure:
 *   - `listMountToolCatalog()` — the cheap `ls`: tool names + scope/stakes
 *     metadata, no input schemas. The MD browses this without context cost.
 *   - `describeMountTools(names)` — the `cat`: page in FULL specs (with input
 *     schemas) for ONLY the subset a turn needs.
 *
 * Pure + additive: reads the existing `BORJIE_PUBLIC_MCP_TOOLS` catalogue and
 * `buildManifest` metadata. No wire-protocol change, no new gating.
 */

import {
  BORJIE_PUBLIC_MCP_TOOLS,
  findPublicTool,
} from './tool-catalog.js';
import { buildManifest } from './manifest.js';
import type {
  BorjieMcpJsonSchema,
  BorjieMcpToolDescriptor,
  BorjieScope,
} from './types.js';

/**
 * Registry-ready descriptor for this service. Structurally compatible with
 * the mount registry's `MountableServer` (minus the live `factory`, which the
 * consumer supplies at wiring time so this module stays I/O-free and
 * dependency-light).
 */
export interface MountServiceDescriptor {
  /** Namespacing-safe id (`/^[a-zA-Z0-9_-]+$/`). */
  readonly id: string;
  readonly name: string;
  readonly project: 'borjie';
  readonly kind: 'gateway';
  readonly description: string;
  /** Parity edge to the sibling BossNyumba public MCP organ. */
  readonly mirrors: string;
  readonly protocolVersion: string;
  readonly transports: ReadonlyArray<'stdio' | 'http' | 'sse'>;
  readonly toolCount: number;
}

/** Cheap catalogue entry — name + gating metadata, no schema (the `ls`). */
export interface MountToolCatalogEntry {
  readonly name: string;
  readonly requiredScopes: ReadonlyArray<BorjieScope>;
  readonly stakes: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly isWrite: boolean;
}

/** The full, paged-in spec for one tool (the `cat` payload). */
export interface MountToolFullSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: BorjieMcpJsonSchema;
  readonly requiredScopes: ReadonlyArray<BorjieScope>;
  readonly stakes: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly isWrite: boolean;
  readonly requiresConfirmation: boolean;
}

export const MOUNT_SERVICE_ID = 'borjie-mcp' as const;

/**
 * Build the registry-ready descriptor for this service. `publicBaseUrl` is
 * threaded through to `buildManifest` so the descriptor carries the same
 * protocol/transport facts the well-known manifest advertises.
 */
export function buildMountServiceDescriptor(opts: {
  readonly publicBaseUrl: string;
}): MountServiceDescriptor {
  const manifest = buildManifest({ publicBaseUrl: opts.publicBaseUrl });
  return Object.freeze({
    id: MOUNT_SERVICE_ID,
    name: 'Borjie public MCP server',
    project: 'borjie' as const,
    kind: 'gateway' as const,
    description:
      "Mr. Mwikila's public brain-tool surface (drafts, opportunities, risks, decisions, scope, marketplace, workforce, production, compliance, estate).",
    mirrors: 'bn-public-mcp',
    protocolVersion: manifest.protocolVersion,
    transports: manifest.transports,
    toolCount: BORJIE_PUBLIC_MCP_TOOLS.length,
  });
}

function toCatalogEntry(t: BorjieMcpToolDescriptor): MountToolCatalogEntry {
  return Object.freeze({
    name: t.name,
    requiredScopes: t.requiredScopes,
    stakes: t.stakes,
    isWrite: t.isWrite,
  });
}

function toFullSpec(t: BorjieMcpToolDescriptor): MountToolFullSpec {
  return Object.freeze({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    requiredScopes: t.requiredScopes,
    stakes: t.stakes,
    isWrite: t.isWrite,
    requiresConfirmation: t.requiresConfirmation,
  });
}

/**
 * `ls` — every tool as name + gating metadata, no input schema. Optionally
 * filtered to writes only / reads only so a read-tier mount never sees write
 * tool names it cannot reach.
 */
export function listMountToolCatalog(
  opts?: { readonly writesOnly?: boolean; readonly readsOnly?: boolean },
): ReadonlyArray<MountToolCatalogEntry> {
  let tools: ReadonlyArray<BorjieMcpToolDescriptor> = BORJIE_PUBLIC_MCP_TOOLS;
  if (opts?.writesOnly) tools = tools.filter((t) => t.isWrite);
  if (opts?.readsOnly) tools = tools.filter((t) => !t.isWrite);
  return Object.freeze(tools.map(toCatalogEntry));
}

/**
 * `cat` — page in the FULL specs for only the requested tool names. Unknown
 * names are silently skipped.
 */
export function describeMountTools(
  names: ReadonlyArray<string>,
): ReadonlyArray<MountToolFullSpec> {
  const out: Array<MountToolFullSpec> = [];
  for (const name of names) {
    const t = findPublicTool(name);
    if (t) out.push(toFullSpec(t));
  }
  return Object.freeze(out);
}
