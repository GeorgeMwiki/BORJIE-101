/**
 * Status loop — the chat-anchored lifecycle of a skill.
 *
 * A compiled skill goes through `active → paused → active → deleted`. Every
 * transition appends an immutable event to the entry's history, and every
 * lifecycle change is mirrored to the chat surface via a short prose line
 * like:
 *
 *   "Your weekly-brief skill ran Monday 7am — opened. Reply 'show' to see it."
 *
 * These functions are storage-agnostic; they delegate to the `SkillRegistry`
 * port. They are async because the registry is.
 */

import type {
  SkillLifecycle,
  SkillRegistry,
  SkillRegistryEntry,
  SkillStatusEvent,
} from '../types.js';

export class SkillNotFoundError extends Error {
  constructor(id: string) {
    super(`Skill not found: ${id}`);
    this.name = 'SkillNotFoundError';
  }
}

export class SkillLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillLifecycleError';
  }
}

export interface PauseSkillArgs {
  readonly nowIso: string;
  readonly reason?: string | undefined;
}

/**
 * Returns the latest registry entry. Throws SkillNotFoundError when missing.
 */
export async function getSkillStatus(
  registry: SkillRegistry,
  id: string,
): Promise<SkillRegistryEntry> {
  const entry = await registry.load(id);
  if (!entry) throw new SkillNotFoundError(id);
  return entry;
}

export async function pauseSkill(
  registry: SkillRegistry,
  id: string,
  args: PauseSkillArgs,
): Promise<SkillRegistryEntry> {
  const next = await registry.update(id, (entry) =>
    transitionTo(entry, 'paused', {
      at: args.nowIso,
      kind: 'paused',
      ...(args.reason !== undefined ? { note: args.reason } : {}),
    }),
  );
  if (!next) throw new SkillNotFoundError(id);
  return next;
}

export async function resumeSkill(
  registry: SkillRegistry,
  id: string,
  args: { readonly nowIso: string },
): Promise<SkillRegistryEntry> {
  const next = await registry.update(id, (entry) => {
    if (entry.lifecycle !== 'paused') {
      throw new SkillLifecycleError(
        `cannot resume skill "${id}" — it is "${entry.lifecycle}", not "paused"`,
      );
    }
    return transitionTo(entry, 'active', { at: args.nowIso, kind: 'resumed' });
  });
  if (!next) throw new SkillNotFoundError(id);
  return next;
}

export async function deleteSkill(
  registry: SkillRegistry,
  id: string,
  args: { readonly nowIso: string; readonly reason?: string | undefined },
): Promise<SkillRegistryEntry> {
  const next = await registry.update(id, (entry) =>
    transitionTo(entry, 'deleted', {
      at: args.nowIso,
      kind: 'deleted',
      ...(args.reason !== undefined ? { note: args.reason } : {}),
    }),
  );
  if (!next) throw new SkillNotFoundError(id);
  return next;
}

/**
 * Append a run-started / run-completed / run-failed event without changing
 * the lifecycle. Used by the runtime adapter when reporting back to the
 * registry. Returns the updated entry.
 */
export async function recordRun(
  registry: SkillRegistry,
  id: string,
  args: {
    readonly nowIso: string;
    readonly outcome: 'started' | 'completed' | 'failed';
    readonly note?: string | undefined;
  },
): Promise<SkillRegistryEntry> {
  const kind: SkillStatusEvent['kind'] =
    args.outcome === 'started'
      ? 'run-started'
      : args.outcome === 'completed'
        ? 'run-completed'
        : 'run-failed';

  const next = await registry.update(id, (entry) => {
    const history: ReadonlyArray<SkillStatusEvent> = [
      ...entry.history,
      Object.freeze({
        at: args.nowIso,
        kind,
        ...(args.note !== undefined ? { note: args.note } : {}),
      }),
    ];

    const isTerminalEvent = args.outcome === 'completed' || args.outcome === 'failed';
    return Object.freeze({
      ...entry,
      history: Object.freeze(history),
      runCount: args.outcome === 'started' ? entry.runCount + 1 : entry.runCount,
      lastRun: isTerminalEvent
        ? Object.freeze({
            at: args.nowIso,
            outcome:
              args.outcome === 'completed'
                ? ('completed' as const)
                : ('failed' as const),
            ...(args.note !== undefined ? { note: args.note } : {}),
          })
        : args.outcome === 'started'
          ? Object.freeze({
              at: args.nowIso,
              outcome: 'in-progress' as const,
              ...(args.note !== undefined ? { note: args.note } : {}),
            })
          : entry.lastRun,
    });
  });
  if (!next) throw new SkillNotFoundError(id);
  return next;
}

function transitionTo(
  entry: SkillRegistryEntry,
  to: SkillLifecycle,
  event: SkillStatusEvent,
): SkillRegistryEntry {
  if (entry.lifecycle === to) {
    throw new SkillLifecycleError(`skill "${entry.id}" is already "${to}"`);
  }
  // A deleted skill is terminal — never re-activate.
  if (entry.lifecycle === 'deleted') {
    throw new SkillLifecycleError(`cannot transition deleted skill "${entry.id}" to "${to}"`);
  }
  return Object.freeze({
    ...entry,
    lifecycle: to,
    history: Object.freeze([...entry.history, Object.freeze(event)]),
  });
}
