/**
 * Visibility Contracts
 *
 * Every artifact flowing through the Brain (messages, tool calls, handoff
 * packets) carries a `VisibilityScope`. This is what lets the Coworker
 * persona sit next to an employee without becoming a surveillance tool:
 * the employee's private scratchpad stays `private`, only explicit promotion
 * makes it visible to team leaders or management.
 *
 * Visibility is enforced by the Thread Store on read, and by the Orchestrator
 * when constructing the context for a downstream persona. It is NOT enforced
 * by the LLM itself — the executor never sees messages it is not allowed to
 * see.
 */

import { z } from 'zod';

/**
 * Visibility scopes, ordered from most restricted to least.
 * `private` is the tightest — only the author and the human who initiated
 * the current turn can see it.
 */
export const VisibilityScope = {
  /** Only the author persona + initiating human. */
  PRIVATE: 'private',
  /** The team bound to the persona + management. */
  TEAM: 'team',
  /** Admins and team leaders across the tenant. */
  MANAGEMENT: 'management',
  /** Full tenant audit surface (incl. compliance review). */
  PUBLIC: 'public',
} as const;

export type VisibilityScope =
  (typeof VisibilityScope)[keyof typeof VisibilityScope];

export const VisibilityScopeSchema = z.enum([
  'private',
  'team',
  'management',
  'public',
]);

/**
 * Ordering: higher = wider audience. Used for `canSee` checks.
 */
const SCOPE_RANK: Record<VisibilityScope, number> = {
  private: 0,
  team: 1,
  management: 2,
  public: 3,
};

/**
 * An actor requesting to view a scoped artifact. Matching rules:
 *  - `private` is visible only to the `authorActorId` or the `initiatingUserId`.
 *  - `team` is visible to members of `teamId` and to management.
 *  - `management` is visible to admins and team leaders.
 *  - `public` is visible to anyone in the tenant.
 */
export interface VisibilityViewer {
  userId: string;
  roles: string[];
  teamIds: string[];
  isManagement?: boolean;
  isAdmin?: boolean;
}

export interface VisibilityLabel {
  scope: VisibilityScope;
  /** Actor (persona or human) that authored the artifact. */
  authorActorId: string;
  /** User whose session/turn produced the artifact. */
  initiatingUserId?: string;
  /** Team binding for `team` scope. */
  teamId?: string;
  /** Explanation shown in the UI visibility badge. */
  rationale?: string;
}

export const VisibilityLabelSchema = z.object({
  scope: VisibilityScopeSchema,
  authorActorId: z.string().min(1),
  initiatingUserId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  rationale: z.string().max(500).optional(),
});

/**
 * Decide whether a viewer can see an artifact under a given visibility label.
 */
export function canSee(label: VisibilityLabel, viewer: VisibilityViewer): boolean {
  // Admin override — full tenant read. This is auditable via governance.
  if (viewer.isAdmin) return true;

  switch (label.scope) {
    case 'public':
      return true;
    case 'management':
      return Boolean(viewer.isManagement) ||
        viewer.roles.some((r) => r === 'team_leader' || r === 'manager');
    case 'team':
      if (label.teamId && viewer.teamIds.includes(label.teamId)) return true;
      return (
        Boolean(viewer.isManagement) ||
        viewer.roles.some((r) => r === 'team_leader' || r === 'manager')
      );
    case 'private':
      return (
        viewer.userId === label.authorActorId ||
        viewer.userId === label.initiatingUserId
      );
  }
}

/**
 * Narrow a list of scoped artifacts down to those the viewer may see.
 * Stable: preserves original order.
 */
export function filterVisible<T extends { visibility: VisibilityLabel }>(
  artifacts: T[],
  viewer: VisibilityViewer
): T[] {
  return artifacts.filter((a) => canSee(a.visibility, viewer));
}

/**
 * Promote a visibility label to a wider scope. Returns a new label.
 * Refuses to narrow (precondition: target >= current).
 */
export function promoteScope(
  label: VisibilityLabel,
  target: VisibilityScope,
  rationale: string
): VisibilityLabel {
  if (SCOPE_RANK[target] < SCOPE_RANK[label.scope]) {
    throw new Error(
      `promoteScope cannot narrow visibility (${label.scope} -> ${target})`
    );
  }
  return { ...label, scope: target, rationale };
}

/**
 * Intersect two visibility labels — the result is the *tighter* of the two.
 * Used when constructing context for a downstream persona: the forwarded
 * artifact cannot be more visible than the turn's own visibility budget.
 */
export function intersect(
  a: VisibilityLabel,
  b: VisibilityLabel
): VisibilityLabel {
  return SCOPE_RANK[a.scope] <= SCOPE_RANK[b.scope] ? a : b;
}

/**
 * Human-readable badge text for UI rendering.
 */
export function scopeBadge(scope: VisibilityScope): {
  label: string;
  tone: 'muted' | 'info' | 'warning' | 'success';
} {
  switch (scope) {
    case 'private':
      return { label: 'Private', tone: 'muted' };
    case 'team':
      return { label: 'Team', tone: 'info' };
    case 'management':
      return { label: 'Management', tone: 'warning' };
    case 'public':
      return { label: 'Tenant', tone: 'success' };
  }
}
