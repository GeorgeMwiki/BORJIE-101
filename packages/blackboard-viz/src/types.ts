/**
 * `@borjie/blackboard-viz` — public types.
 *
 * Pure contracts only. No runtime. Every view + sub-component speaks
 * these shapes. Persona owner: Mr. Mwikila (mining-domain auditor).
 *
 * Design intent: the package never owns the blackboard data. A
 * `BlackboardDataSource` is injected from the host. The four views
 * are pure functions of (posts, presence) → rendered DOM, with the
 * exception of internal local state for collapse / focus / scroll
 * position.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Core blackboard primitives — engine-agnostic.
// ─────────────────────────────────────────────────────────────────────

/**
 * Knowledge-state classification for a post. Drives the `KS` badge
 * on `PostCard` and the chromatic mapping in the OKLCH theme.
 */
export type KnowledgeState =
  | 'decision'
  | 'evidence'
  | 'question'
  | 'action'
  | 'observation'
  | 'error';

export const KNOWLEDGE_STATES: readonly KnowledgeState[] = [
  'decision',
  'evidence',
  'question',
  'action',
  'observation',
  'error',
] as const;

/**
 * Per-region lifecycle state — drives the Kanban columns.
 */
export type RegionStatus = 'open' | 'in-progress' | 'blocked' | 'resolved';

export const REGION_STATUSES: readonly RegionStatus[] = [
  'open',
  'in-progress',
  'blocked',
  'resolved',
] as const;

/**
 * Author of a post. `kind` distinguishes a human operator from a
 * junior agent so the UI can render different avatars and badges.
 */
export interface BlackboardAuthor {
  readonly id: string;
  readonly name: string;
  readonly kind: 'human' | 'agent';
  readonly avatarUrl?: string;
}

/**
 * An immutable post on the blackboard. The sibling BLACKBOARD-CORE
 * wave owns this shape; this package consumes it read-only.
 */
export interface BlackboardPost {
  readonly id: string;
  readonly author: BlackboardAuthor;
  /** ISO-8601 UTC. */
  readonly createdAt: string;
  /** ISO-8601 UTC; absent when never edited. */
  readonly updatedAt?: string;
  /** Free-form markdown content. */
  readonly body: string;
  readonly knowledgeState: KnowledgeState;
  /** Logical region (e.g. "Pit B safety review"). */
  readonly region: string;
  readonly regionStatus: RegionStatus;
  /** Parent post id for threaded view. Absent on root posts. */
  readonly parentId?: string;
  /** Cross-references to other post ids for the tree-graph view. */
  readonly refs?: ReadonlyArray<string>;
  /** Edit history snapshot count; 0 when never edited. */
  readonly editCount?: number;
  /** Reactions, keyed by emoji shortcode, value is count. */
  readonly reactions?: Readonly<Record<string, number>>;
}

export const BlackboardPostSchema = z.object({
  id: z.string().min(1),
  author: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['human', 'agent']),
    avatarUrl: z.string().optional(),
  }),
  createdAt: z.string().min(1),
  updatedAt: z.string().optional(),
  body: z.string(),
  knowledgeState: z.enum([
    'decision',
    'evidence',
    'question',
    'action',
    'observation',
    'error',
  ]),
  region: z.string().min(1),
  regionStatus: z.enum(['open', 'in-progress', 'blocked', 'resolved']),
  parentId: z.string().optional(),
  refs: z.array(z.string()).optional(),
  editCount: z.number().int().min(0).optional(),
  reactions: z.record(z.number().int().min(0)).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// View modes + view props
// ─────────────────────────────────────────────────────────────────────

export type BlackboardViewMode = 'timeline' | 'threaded' | 'kanban' | 'tree-graph';

export const BLACKBOARD_VIEW_MODES: readonly BlackboardViewMode[] = [
  'timeline',
  'threaded',
  'kanban',
  'tree-graph',
] as const;

/**
 * The mode controls whether the Kanban (and any future destructive
 * surface) can propose a mutation. `readonly` is the default; nothing
 * mutates without an explicit `mode: 'mutate'` *and* an injected
 * `mutationAuthority`.
 */
export type BlackboardMode = 'readonly' | 'mutate';

/**
 * Entity reference parsed out of a post body. The `EntityLink`
 * component recognises the three shapes and emits a typed click event.
 */
export type EntityRef =
  | { readonly kind: 'user'; readonly id: string; readonly label: string }
  | { readonly kind: 'region'; readonly id: string; readonly label: string }
  | { readonly kind: 'tool'; readonly id: string; readonly label: string };

/**
 * Live-cursor state broadcast by other participants.
 */
export interface LiveCursorState {
  readonly userId: string;
  readonly name: string;
  readonly colorOklch: string;
  readonly x: number;
  readonly y: number;
  /** ISO-8601; cursors older than 5 s are not rendered. */
  readonly updatedAt: string;
  /** Optional id of the post the cursor is hovering. */
  readonly hoverPostId?: string;
}

/**
 * Search / filter state shared between `SearchBar` and the views.
 */
export interface BlackboardFilter {
  readonly query: string;
  readonly knowledgeStates: ReadonlySet<KnowledgeState>;
  readonly regions: ReadonlySet<string>;
  readonly authors: ReadonlySet<string>;
  /** ISO-8601 lower bound (inclusive); empty string means "no bound". */
  readonly startDate: string;
  /** ISO-8601 upper bound (inclusive); empty string means "no bound". */
  readonly endDate: string;
}

export const EMPTY_FILTER: BlackboardFilter = {
  query: '',
  knowledgeStates: new Set<KnowledgeState>(),
  regions: new Set<string>(),
  authors: new Set<string>(),
  startDate: '',
  endDate: '',
};

/**
 * Custom DOM event dispatched on the view root when an entity link is
 * clicked. Host portals listen for this event to handle navigation.
 */
export interface BlackboardEntityClickEventDetail {
  readonly ref: EntityRef;
  /** The post id where the click originated. */
  readonly originPostId: string;
}

/**
 * Mutation proposal handle injected when `mode === 'mutate'`. The
 * package never calls a real database; it only proposes. Production
 * wiring binds this to `@borjie/mutation-authority` recipes.
 */
export interface BlackboardMutationAuthority {
  readonly proposeMove: (
    postId: string,
    targetStatus: RegionStatus,
  ) => Promise<{ readonly proposalId: string }>;
}

/**
 * Common props every view component accepts.
 */
export interface ViewProps {
  readonly posts: ReadonlyArray<BlackboardPost>;
  readonly filter?: BlackboardFilter;
  readonly mode?: BlackboardMode;
  readonly mutationAuthority?: BlackboardMutationAuthority;
  readonly presence?: ReadonlyArray<LiveCursorState>;
  /** Optional localStorage key prefix for per-node collapse state etc. */
  readonly persistKey?: string;
  /**
   * Optional callback fired when the view wants to announce something
   * to a screen reader. The package wires its own `announcer` by
   * default; tests can capture announcements by overriding this.
   */
  readonly onAnnounce?: (message: string) => void;
  /**
   * Optional callback when a post is focused. The view-switch
   * preserve-scroll behaviour uses this to remember the focused id.
   */
  readonly onFocusPost?: (postId: string) => void;
}

/**
 * The selection rules picked by the GenUI block + the view switcher.
 */
export const BlackboardVizBlockSchema = z.object({
  kind: z.literal('blackboard'),
  view: z.enum(['timeline', 'threaded', 'kanban', 'tree-graph']).optional(),
  title: z.string().optional(),
  posts: z.array(BlackboardPostSchema),
  /** When omitted, the block mounts in 'readonly' mode. */
  mode: z.enum(['readonly', 'mutate']).optional(),
});

export type BlackboardVizBlockPayload = z.infer<typeof BlackboardVizBlockSchema>;
