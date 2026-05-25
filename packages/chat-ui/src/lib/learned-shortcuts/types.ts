/**
 * Learned-Shortcuts — shared types.
 *
 * These types describe the contract between the `user_action_tracker`
 * Supabase table (owned by UI-3's migration in `packages/database`)
 * and the chat-ui ranker + panel. The ranker reads denormalised rows
 * from the table; the panel renders ranked entries; the hook glues
 * the two together via a pluggable fetcher.
 *
 * The table is OWNED by UI-3 — this file does NOT define the SQL
 * schema, only the wire-shape consumed by chat-ui after a Supabase
 * `select(...)` call. Field names match the table columns 1:1 so
 * callers can pass raw rows in without remapping.
 */
import type { CSSProperties } from 'react';

/**
 * A single counted action — one row per (userId, route, actionId)
 * tuple from `user_action_tracker`. The chat-ui ranker is pure and
 * decoupled from Supabase: pass these in, get a ranked list out.
 */
export interface UserActionTrackerRow {
  /** Stable action identifier — e.g. `nav:portfolio.add-property`. */
  readonly id: string;
  /** Display label — e.g. "Add property". Localised upstream. */
  readonly label: string;
  /** Optional icon name from the consuming app's icon set. */
  readonly icon?: string;
  /** Optional route the action navigates to when clicked. */
  readonly route?: string;
  /** Total times the action was fired by this user on this route. */
  readonly frequency: number;
  /** ISO-8601 timestamp of the most-recent invocation. */
  readonly lastSeenIso: string;
  /** Number of times the action was confirmed / completed. */
  readonly successCount: number;
  /** Number of times the action was cancelled / dismissed. */
  readonly cancelCount: number;
}

/**
 * The ranked output entry rendered by `<LearnedShortcutsPanel />`.
 * `confidence` is the normalised score (0..1) — the highest-ranked
 * item is always 1, others scale relative to it. Lets the UI show
 * a single shared progress bar / pill without each consumer needing
 * to know the absolute score scale.
 */
export interface LearnedShortcut {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly route?: string;
  /** Normalised score in [0, 1] — relative confidence vs top entry. */
  readonly confidence: number;
}

/**
 * Configuration knobs for the ranker. Defaults match the spec:
 *   - half-life ≈ 7 days (≈ recencyWeight = 0.5 after one week)
 *   - confirmation floor 0.5 so brand-new actions don't get crushed
 *   - top-5 default
 */
export interface RankerOptions {
  /** Reference "now" for recency math — defaults to `Date.now()`. */
  readonly now?: number;
  /** Recency half-life in milliseconds — defaults to 7 days. */
  readonly halfLifeMs?: number;
  /**
   * Top-N to return. Defaults to 5. The ranker may return fewer when
   * the input list is shorter than `topN`.
   */
  readonly topN?: number;
  /**
   * Optional ordered list of pinned IDs. Pinned entries are forced to
   * the front in the order supplied, regardless of computed score.
   * Pinned entries that are absent from the input list are dropped.
   */
  readonly pinnedIds?: ReadonlyArray<string>;
}

/**
 * Stale-while-revalidate cache entry kept inside the hook. Exported
 * so tests can construct deterministic fixtures.
 */
export interface ShortcutsCacheEntry {
  readonly fetchedAt: number;
  readonly rows: ReadonlyArray<UserActionTrackerRow>;
}

/**
 * Hook contract — callers supply a fetcher (typed against Supabase)
 * and the hook handles caching, route scoping, and ranking.
 */
export interface UseLearnedShortcutsOptions {
  /**
   * Stable user identifier. The hook returns `null` shortcuts when
   * `userId` is empty — lets consumers wire it unconditionally during
   * SSR / before auth resolves.
   */
  readonly userId: string;
  /**
   * Route key — typically `location.pathname` or a normalised slug
   * the consuming app uses for action namespacing. Pinned-state and
   * ranker scope are both per-route.
   */
  readonly route: string;
  /**
   * Async loader returning rows for (userId, route). Owned by the
   * consuming app — typically wraps Supabase
   *   `.from('user_action_tracker').select('*').eq('user_id', userId).eq('route', route)`.
   */
  readonly fetcher: (params: {
    readonly userId: string;
    readonly route: string;
  }) => Promise<ReadonlyArray<UserActionTrackerRow>>;
  /**
   * Mastery threshold — below this number of distinct actions on the
   * route the hook returns `null` and the panel hides itself.
   * Defaults to 3.
   */
  readonly masteryThreshold?: number;
  /**
   * Cache TTL — within this window the cached rows are served as-is
   * and a background refresh is fired (stale-while-revalidate).
   * Defaults to 5 minutes.
   */
  readonly staleAfterMs?: number;
  /**
   * Top-N forwarded to the ranker. Defaults to 5.
   */
  readonly topN?: number;
  /**
   * Override storage for pinning — defaults to `window.localStorage`.
   * Lets tests swap in a controllable Map.
   */
  readonly storage?: PinnedStorage;
}

/**
 * Storage abstraction so tests can swap localStorage out without
 * monkey-patching globals.
 */
export interface PinnedStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

/**
 * Hook return value. `shortcuts === null` means "below mastery
 * threshold OR no userId" → panel should render nothing.
 */
export interface UseLearnedShortcutsResult {
  readonly shortcuts: ReadonlyArray<LearnedShortcut> | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Pin or move an action to the top of the panel for this route. */
  readonly pin: (id: string) => void;
  /** Remove a pin so the entry re-enters the ranker pool. */
  readonly unpin: (id: string) => void;
  /** Force a refresh — clears the cache and re-fetches. */
  readonly refresh: () => void;
}

/**
 * Props for the `<LearnedShortcutsPanel />` component.
 */
export interface LearnedShortcutsPanelProps {
  readonly shortcuts: ReadonlyArray<LearnedShortcut>;
  readonly onActionClick: (id: string) => void;
  /** Visible shortcuts before "Show more" expand — defaults to 5. */
  readonly maxVisible?: number;
  /** Bottom-right floating panel vs inline in-page card. */
  readonly placement?: 'floating' | 'inline';
  /**
   * Fired when the user drags an item to re-pin it. The panel does
   * not own pin storage — wire this to `useLearnedShortcuts().pin`.
   */
  readonly onPin?: (id: string) => void;
  /** Optional className for the outer container. */
  readonly className?: string;
  /** Optional inline-style override. */
  readonly style?: CSSProperties;
  /** Headline text (i18n). Defaults to "Your shortcuts". */
  readonly headline?: string;
}
