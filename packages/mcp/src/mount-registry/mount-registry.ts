/**
 * MCP mount registry — the single place where every Borjie (and BossNyumba)
 * service is declared mountable as an MCP server the one MD owns.
 *
 * The MD-as-Body capstone (`Docs/research/MD_AS_BODY_ARCHITECTURE.md`, lane
 * "Mount every Borjie+BN service as an MCP server the one MD owns") needs a
 * declarative catalogue of mountable organs. Each entry names a service, the
 * project it belongs to, and a *factory* that builds a live `MCPServer` bound
 * to a tenant scope. Mounting is lazy: a factory only runs when the MD
 * actually attaches the organ, so declaring 26 Borjie + 9 BN services costs
 * nothing until used.
 *
 * This module is ADDITIVE and pure — it composes the existing
 * `createMCPServer` framework + in-memory transport + client; it never edits
 * the wire protocol or the server framework. Mounting an organ produces a
 * linked client the MD calls through, and a `detach()` to reclaim it.
 *
 * The `mirrors` edge (Borjie<->BN parity, per the registry that already says
 * it "mirrors the BN sub-MD registry") is carried as a first-class field so a
 * future system-graph pass can draw parity edges between the two projects.
 */

import { createInMemoryTransportPair } from '../transport/in-memory.js';
import { createMCPClient, type MCPClient } from '../client/index.js';
import type { MCPServer } from '../server/index.js';
import type { SessionContext } from '../types.js';

/** Which project an organ belongs to. */
export type MountProject = 'borjie' | 'bossnyumba';

/**
 * A service-kind tag — used by the system-graph derivation to bucket organs
 * and by progressive disclosure to group tool specs. Free-form by design so
 * new service families don't require a type edit.
 */
export type MountKind =
  | 'service'
  | 'package'
  | 'domain-server'
  | 'junior'
  | 'sub-md'
  | 'gateway';

/**
 * Declarative description of a mountable MCP organ. The `factory` is lazy —
 * it builds a fresh `MCPServer` bound to the given session scope only when
 * the MD mounts the organ.
 */
export interface MountableServer {
  /** Stable, namespacing-safe id (`/^[a-zA-Z0-9_-]+$/`). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  readonly project: MountProject;
  readonly kind: MountKind;
  readonly description?: string;
  /**
   * Parity edge — the id of the corresponding organ in the sibling project
   * (Borjie<->BN). Lets the system-graph draw `mirrors` edges for free.
   */
  readonly mirrors?: string;
  /**
   * Lazy factory. Receives the session context (tenant scope) so the produced
   * server is tenant-bound; returns a live `MCPServer`.
   */
  readonly factory: (ctx: SessionContext) => MCPServer;
}

/** A live, attached organ: the server, the MD's client, and a reclaim hook. */
export interface MountedServer {
  readonly id: string;
  readonly server: MCPServer;
  readonly client: MCPClient;
  /** Detach the organ — closes the transport pair and the client. */
  detach(): Promise<void>;
}

/** Validation guard — keeps every id safe for `namespace()`. */
function assertMountId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(
      `Invalid mount id '${id}' — must match /^[a-zA-Z0-9_-]+$/ to be namespacing-safe`,
    );
  }
}

export interface MountRegistry {
  /** Register a mountable organ. Throws on duplicate or invalid id. */
  register(entry: MountableServer): void;
  /** Register many organs at once. */
  registerAll(entries: ReadonlyArray<MountableServer>): void;
  /** Every declared organ (not yet mounted). */
  list(): ReadonlyArray<MountableServer>;
  /** Look up a declaration by id. */
  get(id: string): MountableServer | undefined;
  /** True when an organ is declared. */
  has(id: string): boolean;
  /** Organs filtered by project. */
  byProject(project: MountProject): ReadonlyArray<MountableServer>;
  /** Organs filtered by kind. */
  byKind(kind: MountKind): ReadonlyArray<MountableServer>;
  /**
   * Mount one organ: run its factory, link a client over an in-memory
   * transport pair, initialize the handshake, and return the live handle.
   */
  mount(id: string, ctx: SessionContext): Promise<MountedServer>;
}

/**
 * Build a fresh mount registry. Optionally seed it with declarations.
 */
export function createMountRegistry(
  seed?: ReadonlyArray<MountableServer>,
): MountRegistry {
  const entries = new Map<string, MountableServer>();

  function register(entry: MountableServer): void {
    assertMountId(entry.id);
    if (entries.has(entry.id)) {
      throw new Error(`Mount id '${entry.id}' is already registered`);
    }
    entries.set(entry.id, Object.freeze({ ...entry }));
  }

  function registerAll(list: ReadonlyArray<MountableServer>): void {
    for (const e of list) register(e);
  }

  if (seed) registerAll(seed);

  async function mount(
    id: string,
    ctx: SessionContext,
  ): Promise<MountedServer> {
    const entry = entries.get(id);
    if (!entry) {
      throw new Error(
        `No mountable organ registered for id '${id}' — known: [${[...entries.keys()].join(', ')}]`,
      );
    }
    const server = entry.factory(ctx);
    const pair = createInMemoryTransportPair();
    const attached = server.attach(pair.server, ctx);
    const client = createMCPClient({ transport: pair.client });
    await client.initialize();
    return Object.freeze({
      id,
      server,
      client,
      async detach(): Promise<void> {
        await client.close();
        await attached.detach();
      },
    });
  }

  return Object.freeze({
    register,
    registerAll,
    list: () => Object.freeze([...entries.values()]),
    get: (id: string) => entries.get(id),
    has: (id: string) => entries.has(id),
    byProject: (project: MountProject) =>
      Object.freeze([...entries.values()].filter((e) => e.project === project)),
    byKind: (kind: MountKind) =>
      Object.freeze([...entries.values()].filter((e) => e.kind === kind)),
    mount,
  });
}
