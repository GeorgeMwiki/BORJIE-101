/**
 * InMemoryWorktreeManager — deterministic test stub for worktree lifecycle.
 * Records create + remove events in order so tests can assert lifecycle.
 */

import type { WorktreeManager } from './spawn.js';
import type { WorktreeIsolation } from './types.js';

export interface WorktreeEvent {
  readonly op: 'create' | 'remove';
  readonly branch: string;
  readonly path: string;
}

export class InMemoryWorktreeManager implements WorktreeManager {
  private readonly _events: Array<WorktreeEvent> = [];

  get events(): ReadonlyArray<WorktreeEvent> {
    return this._events;
  }

  async create(iso: WorktreeIsolation): Promise<{ readonly path: string }> {
    this._events.push({ op: 'create', branch: iso.branch, path: iso.path });
    return { path: iso.path };
  }

  async remove(iso: WorktreeIsolation): Promise<void> {
    this._events.push({ op: 'remove', branch: iso.branch, path: iso.path });
  }
}
