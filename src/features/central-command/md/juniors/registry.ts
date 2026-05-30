/**
 * Junior-agent registry — a tiny in-process map from juniorId to port.
 *
 * Frozen on creation. The MD chat route reads this at request time to
 * decide whether a user request maps to a junior (e.g. "ingest this
 * CSV" → `hr-csv-ingest`).
 *
 * Mirrors Borjie101 TaskAgentRegistry but stripped of its
 * lazy-loading layer — Borjie's juniors are small enough to live in
 * memory.
 *
 * @module features/central-command/md/juniors/registry
 */

import type { MdJuniorPort } from "./types";

export interface JuniorRegistry {
  /** Look up a junior by id. Returns undefined when unknown. */
  get(id: string): MdJuniorPort | undefined;
  /** List all juniors in registration order. */
  list(): ReadonlyArray<MdJuniorPort>;
  /** Filter by domain (e.g. "hr") — handy for the MD's planner prompt. */
  byDomain(domain: MdJuniorPort["domain"]): ReadonlyArray<MdJuniorPort>;
  /** Whether a junior with the given id is registered. */
  has(id: string): boolean;
}

export function makeJuniorRegistry(
  juniors: ReadonlyArray<MdJuniorPort>,
): JuniorRegistry {
  const map = new Map<string, MdJuniorPort>();
  for (const j of juniors) {
    if (map.has(j.id)) {
      throw new Error(`[md.juniors.registry] duplicate junior id: "${j.id}"`);
    }
    map.set(j.id, j);
  }
  const ordered = Object.freeze([...juniors]);
  return Object.freeze({
    get(id: string): MdJuniorPort | undefined {
      return map.get(id);
    },
    list(): ReadonlyArray<MdJuniorPort> {
      return ordered;
    },
    byDomain(domain: MdJuniorPort["domain"]): ReadonlyArray<MdJuniorPort> {
      return Object.freeze(ordered.filter((j) => j.domain === domain));
    },
    has(id: string): boolean {
      return map.has(id);
    },
  });
}

/**
 * Compact "manifest" view the MD's planner prompt can serialise into
 * its system message. Strips runtime state (execute) and leaves the
 * agentic LLM enough to decide whether/which junior to spawn.
 */
export interface JuniorManifestRow {
  readonly id: string;
  readonly label: string;
  readonly domain: MdJuniorPort["domain"];
  readonly description: string;
  readonly triggerKind: MdJuniorPort["trigger"]["kind"];
}

export function juniorManifest(
  registry: JuniorRegistry,
): ReadonlyArray<JuniorManifestRow> {
  return Object.freeze(
    registry.list().map((j) =>
      Object.freeze({
        id: j.id,
        label: j.label,
        domain: j.domain,
        description: j.description,
        triggerKind: j.trigger.kind,
      }),
    ),
  );
}
