/**
 * Progressive-disclosure loader — "tools as a /proc filesystem".
 *
 * The MD-as-Body capstone mounts every Borjie + BN service plus 50+ juniors
 * as MCP organs. Eagerly loading every tool's full JSON-Schema into the model
 * context window does not scale — it is the exact "context blow-up" the
 * code-execution-with-MCP pattern (Anthropic, Nov 2025) exists to solve. The
 * fix is a filesystem-shaped view over the mount registry:
 *
 *   - `ls`   — list organ ids + tool *names* only (a few tokens each). The
 *              model browses the catalogue cheaply, exactly like `ls /proc`.
 *   - `stat` — one-line summary (name + truncated description) for a path.
 *   - `cat`  — page in the FULL spec (description + input schema) for ONLY
 *              the handful of tools a turn actually needs.
 *
 * So a turn that needs 3 of 400 tools pays for 3 specs, not 400. Listing is
 * O(catalogue) in *names*; loading is O(selection) in *bytes*.
 *
 * This module is pure + additive: it reads `MountRegistry` declarations and
 * (for `cat`) mounts an organ on demand to read its live `tools/list`, then
 * detaches. It never edits the wire protocol or the server framework.
 */

import type { SessionContext } from '../types.js';
import { namespace } from '../discovery/discovery.js';
import type { MountRegistry, MountableServer } from './mount-registry.js';

/** One entry in the cheap `ls` view — a path + its kind, no schema. */
export interface DisclosurePathEntry {
  /** Namespaced path `<organId>/<toolName>` (filesystem-shaped). */
  readonly path: string;
  readonly organId: string;
  readonly toolName: string;
}

/** A loaded (paged-in) tool spec — the expensive `cat` payload. */
export interface DisclosedToolSpec {
  readonly path: string;
  readonly organId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** Organ-level summary for the `ls` of the registry root. */
export interface OrganSummary {
  readonly organId: string;
  readonly name: string;
  readonly project: string;
  readonly kind: string;
  readonly description?: string;
  readonly mirrors?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export interface ProgressiveDisclosure {
  /** `ls /` — every mountable organ, no tool specs loaded. */
  listOrgans(): ReadonlyArray<OrganSummary>;
  /**
   * `ls /<organId>` — the tool *paths* exposed by one organ. Mounts the
   * organ briefly to read its `tools/list`, then detaches. Names only.
   */
  listTools(
    organId: string,
    ctx: SessionContext,
  ): Promise<ReadonlyArray<DisclosurePathEntry>>;
  /**
   * `ls /` recursively — every tool path across every organ, names only.
   * This is the cheap catalogue the model browses before deciding what to
   * `load`. Bounded by `maxOrgans` so a huge body stays pageable.
   */
  listAllTools(
    ctx: SessionContext,
    opts?: { readonly organIds?: ReadonlyArray<string>; readonly maxOrgans?: number },
  ): Promise<ReadonlyArray<DisclosurePathEntry>>;
  /**
   * `stat <path>` — one-line summary for a single tool path (name + a
   * truncated description). Cheap; loads one organ's list, not its schemas.
   */
  stat(
    path: string,
    ctx: SessionContext,
  ): Promise<{ readonly path: string; readonly summary: string } | null>;
  /**
   * `cat <path...>` — page in the FULL spec for only the requested tool
   * paths. Groups by organ so each organ is mounted at most once. This is
   * the ONLY call that pulls input schemas into context.
   */
  load(
    paths: ReadonlyArray<string>,
    ctx: SessionContext,
  ): Promise<ReadonlyArray<DisclosedToolSpec>>;
}

/** Split a `<organId>/<toolName>` path. Returns null when malformed. */
export function splitDisclosurePath(
  path: string,
): { readonly organId: string; readonly toolName: string } | null {
  const idx = path.indexOf('/');
  if (idx <= 0 || idx === path.length - 1) return null;
  return {
    organId: path.slice(0, idx),
    toolName: path.slice(idx + 1),
  };
}

/** Build the namespaced filesystem path for a tool. */
export function disclosurePath(organId: string, toolName: string): string {
  return `${organId}/${toolName}`;
}

function organSummary(entry: MountableServer): OrganSummary {
  const out: { -readonly [K in keyof OrganSummary]: OrganSummary[K] } = {
    organId: entry.id,
    name: entry.name,
    project: entry.project,
    kind: entry.kind,
  };
  if (entry.description !== undefined) out.description = entry.description;
  if (entry.mirrors !== undefined) out.mirrors = entry.mirrors;
  return Object.freeze(out);
}

export function createProgressiveDisclosure(
  registry: MountRegistry,
): ProgressiveDisclosure {
  /** Mount, read tool name list, detach. Names only — no schemas paged. */
  async function namesFor(
    organId: string,
    ctx: SessionContext,
  ): Promise<ReadonlyArray<DisclosurePathEntry>> {
    const mounted = await registry.mount(organId, ctx);
    try {
      const tools = await mounted.client.listTools();
      return Object.freeze(
        tools.map((t) =>
          Object.freeze({
            path: disclosurePath(organId, t.name),
            organId,
            toolName: t.name,
          }),
        ),
      );
    } finally {
      await mounted.detach();
    }
  }

  return Object.freeze({
    listOrgans(): ReadonlyArray<OrganSummary> {
      return Object.freeze(registry.list().map(organSummary));
    },

    async listTools(
      organId: string,
      ctx: SessionContext,
    ): Promise<ReadonlyArray<DisclosurePathEntry>> {
      if (!registry.has(organId)) {
        throw new Error(`Unknown organ '${organId}'`);
      }
      return namesFor(organId, ctx);
    },

    async listAllTools(
      ctx: SessionContext,
      opts?: { readonly organIds?: ReadonlyArray<string>; readonly maxOrgans?: number },
    ): Promise<ReadonlyArray<DisclosurePathEntry>> {
      const all = registry.list();
      const wanted = opts?.organIds
        ? all.filter((e) => opts.organIds!.includes(e.id))
        : all;
      const bounded =
        opts?.maxOrgans !== undefined ? wanted.slice(0, opts.maxOrgans) : wanted;
      const out: Array<DisclosurePathEntry> = [];
      // Sequential keeps per-organ failures attributable (a body has many
      // organs; one bad factory should not shadow the rest's failure).
      for (const entry of bounded) {
        try {
          const names = await namesFor(entry.id, ctx);
          out.push(...names);
        } catch {
          // An injured limb (failing organ) is skipped here, not fatal —
          // the system-graph health pass flags it elsewhere.
        }
      }
      return Object.freeze(out);
    },

    async stat(
      path: string,
      ctx: SessionContext,
    ): Promise<{ readonly path: string; readonly summary: string } | null> {
      const split = splitDisclosurePath(path);
      if (!split) return null;
      if (!registry.has(split.organId)) return null;
      const mounted = await registry.mount(split.organId, ctx);
      try {
        const tools = await mounted.client.listTools();
        const tool = tools.find((t) => t.name === split.toolName);
        if (!tool) return null;
        return Object.freeze({
          path,
          summary: `${namespace(split.organId, tool.name)} — ${truncate(tool.description, 120)}`,
        });
      } finally {
        await mounted.detach();
      }
    },

    async load(
      paths: ReadonlyArray<string>,
      ctx: SessionContext,
    ): Promise<ReadonlyArray<DisclosedToolSpec>> {
      // Group requested paths by organ so each organ mounts at most once.
      const byOrgan = new Map<string, Set<string>>();
      for (const p of paths) {
        const split = splitDisclosurePath(p);
        if (!split) continue;
        const set = byOrgan.get(split.organId) ?? new Set<string>();
        set.add(split.toolName);
        byOrgan.set(split.organId, set);
      }
      const out: Array<DisclosedToolSpec> = [];
      for (const [organId, toolNames] of byOrgan) {
        if (!registry.has(organId)) continue;
        const mounted = await registry.mount(organId, ctx);
        try {
          const tools = await mounted.client.listTools();
          for (const t of tools) {
            if (!toolNames.has(t.name)) continue;
            out.push(
              Object.freeze({
                path: disclosurePath(organId, t.name),
                organId,
                toolName: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              }),
            );
          }
        } finally {
          await mounted.detach();
        }
      }
      return Object.freeze(out);
    },
  });
}
