/**
 * Region manager — open, transition, close.
 *
 * Wave BLACKBOARD-CORE. Tiny domain service over a
 * `RegionsRepository`. Validates input with Zod, enforces the
 * `open → active → closed` transition lattice, and stamps the
 * `closedAt` timestamp on the terminal transition.
 *
 * Pure of I/O. No SSE emission — the post publisher owns that side.
 * The region manager is the surface that operators and the runtime
 * call to declare the namespace of a problem.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.3, §4.
 */

import { z } from 'zod';
import {
  REGION_KINDS,
  REGION_STATUSES,
  type OpenRegionInput,
  type Region,
  type RegionStatus,
  type RegionsRepository,
} from '../types.js';

const openInputSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  regionKind: z.enum(REGION_KINDS),
  scopeId: z.string().optional(),
});

const transitionInputSchema = z.object({
  tenantId: z.string().min(1),
  id: z.string().min(1),
  next: z.enum(REGION_STATUSES),
});

/**
 * Allowed transitions per the lifecycle lattice (spec §3.3):
 *
 *   open    → active, closed
 *   active  → closed
 *   closed  → (terminal — no further transitions)
 *
 * Self-loops are also rejected — the caller must observe a real change.
 */
const ALLOWED_TRANSITIONS: Record<RegionStatus, ReadonlyArray<RegionStatus>> = {
  open: ['active', 'closed'],
  active: ['closed'],
  closed: [],
};

export class InvalidRegionTransitionError extends Error {
  constructor(
    readonly currentStatus: RegionStatus,
    readonly attemptedStatus: RegionStatus,
  ) {
    super(
      `Invalid region transition: cannot move from "${currentStatus}" to "${attemptedStatus}"`,
    );
    this.name = 'InvalidRegionTransitionError';
  }
}

export class RegionNotFoundError extends Error {
  constructor(readonly tenantId: string, readonly id: string) {
    super(`Region not found: tenant=${tenantId} id=${id}`);
    this.name = 'RegionNotFoundError';
  }
}

export interface RegionManager {
  open(input: OpenRegionInput): Promise<Region>;
  transition(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly next: RegionStatus;
  }): Promise<Region>;
  close(args: { readonly tenantId: string; readonly id: string }): Promise<Region>;
}

export function createRegionManager(deps: {
  readonly repository: RegionsRepository;
}): RegionManager {
  const { repository } = deps;

  return {
    async open(rawInput) {
      const input = openInputSchema.parse(rawInput);
      const openInput: OpenRegionInput = {
        id: input.id,
        tenantId: input.tenantId,
        regionKind: input.regionKind,
        ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
      };
      return repository.open(openInput);
    },

    async transition(rawArgs) {
      const args = transitionInputSchema.parse(rawArgs);
      const current = await repository.get(args.tenantId, args.id);
      if (current === null) {
        throw new RegionNotFoundError(args.tenantId, args.id);
      }
      const allowed = ALLOWED_TRANSITIONS[current.status];
      if (!allowed.includes(args.next)) {
        throw new InvalidRegionTransitionError(current.status, args.next);
      }
      return repository.transition(args.tenantId, args.id, args.next);
    },

    async close(args) {
      return this.transition({
        tenantId: args.tenantId,
        id: args.id,
        next: 'closed',
      });
    },
  };
}
