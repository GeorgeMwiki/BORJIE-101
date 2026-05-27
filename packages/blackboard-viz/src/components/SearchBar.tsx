'use client';

/**
 * SearchBar — full-text + filter chips for the blackboard.
 *
 * Filter dimensions:
 *  - free-text query (substring match on body + author + region)
 *  - knowledge-state chips (multi-select toggle)
 *  - region chips (multi-select toggle, generated from the post stream)
 *  - date-range (start + end inputs)
 *
 * The component is purely presentational; it calls `onChange(next)`
 * with a new immutable `BlackboardFilter`. The host owns persistence.
 *
 * Accessibility:
 *  - Input has `role="searchbox"` and `aria-label`.
 *  - Chips are toggle buttons with `aria-pressed`.
 *  - Date inputs have explicit `<label>` wrappers.
 *  - The bar is `role="search"`.
 */

import type { CSSProperties } from 'react';

import type {
  BlackboardFilter,
  BlackboardPost,
  KnowledgeState,
} from '../types';
import { KNOWLEDGE_STATES, EMPTY_FILTER } from '../types';
import { BLACKBOARD_OKLCH_THEME, tokenForKind } from '../themes/blackboard-oklch';

export interface SearchBarProps {
  readonly filter: BlackboardFilter;
  readonly onChange: (next: BlackboardFilter) => void;
  /** Used to derive the set of region chips from the available posts. */
  readonly posts: ReadonlyArray<BlackboardPost>;
}

function setWith<T>(set: ReadonlySet<T>, value: T, on: boolean): ReadonlySet<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

function barStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    background: BLACKBOARD_OKLCH_THEME.surface.oklch,
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 12,
  };
}

function inputStyle(): CSSProperties {
  return {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 8,
    fontSize: 13,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
  };
}

function chipRowStyle(): CSSProperties {
  return {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  };
}

function chipStyle(active: boolean, color: string): CSSProperties {
  return {
    background: active ? color : 'transparent',
    color: active ? 'white' : color,
    border: `1px solid ${color}`,
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    cursor: 'pointer',
    minHeight: 24,
  };
}

function dateRowStyle(): CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  };
}

function deriveRegions(posts: ReadonlyArray<BlackboardPost>): ReadonlyArray<string> {
  const set = new Set<string>();
  for (const p of posts) set.add(p.region);
  return Array.from(set).sort();
}

export function SearchBar({ filter, onChange, posts }: SearchBarProps): JSX.Element {
  const regions = deriveRegions(posts);

  function handleQuery(query: string): void {
    onChange({ ...filter, query });
  }

  function handleToggleKs(ks: KnowledgeState): void {
    const next = setWith(filter.knowledgeStates, ks, !filter.knowledgeStates.has(ks));
    onChange({ ...filter, knowledgeStates: next });
  }

  function handleToggleRegion(region: string): void {
    const next = setWith(filter.regions, region, !filter.regions.has(region));
    onChange({ ...filter, regions: next });
  }

  function handleStart(start: string): void {
    onChange({ ...filter, startDate: start });
  }

  function handleEnd(end: string): void {
    onChange({ ...filter, endDate: end });
  }

  function handleClear(): void {
    onChange(EMPTY_FILTER);
  }

  return (
    <div role="search" data-testid="search-bar" style={barStyle()}>
      <input
        type="search"
        data-testid="search-bar-input"
        role="searchbox"
        aria-label="Search posts"
        placeholder="Search posts…"
        value={filter.query}
        onChange={(e) => handleQuery(e.target.value)}
        className="bb-focusable"
        style={inputStyle()}
      />

      <div data-testid="search-bar-ks-row" style={chipRowStyle()}>
        {KNOWLEDGE_STATES.map((ks) => {
          const active = filter.knowledgeStates.has(ks);
          return (
            <button
              key={ks}
              type="button"
              data-testid={`chip-ks-${ks}`}
              aria-pressed={active}
              onClick={() => handleToggleKs(ks)}
              className="bb-focusable"
              style={chipStyle(active, tokenForKind(ks).oklch)}
            >
              {ks}
            </button>
          );
        })}
      </div>

      {regions.length > 0 ? (
        <div data-testid="search-bar-region-row" style={chipRowStyle()}>
          {regions.map((r) => {
            const active = filter.regions.has(r);
            return (
              <button
                key={r}
                type="button"
                data-testid={`chip-region-${r}`}
                aria-pressed={active}
                onClick={() => handleToggleRegion(r)}
                className="bb-focusable"
                style={chipStyle(active, BLACKBOARD_OKLCH_THEME.kindObservation.oklch)}
              >
                #{r}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={dateRowStyle()}>
        <label
          style={{ fontSize: 11, color: BLACKBOARD_OKLCH_THEME.muted.oklch }}
        >
          From&nbsp;
          <input
            type="date"
            data-testid="search-bar-start-date"
            value={filter.startDate}
            onChange={(e) => handleStart(e.target.value)}
            className="bb-focusable"
            style={{ ...inputStyle(), width: 140 }}
          />
        </label>
        <label
          style={{ fontSize: 11, color: BLACKBOARD_OKLCH_THEME.muted.oklch }}
        >
          To&nbsp;
          <input
            type="date"
            data-testid="search-bar-end-date"
            value={filter.endDate}
            onChange={(e) => handleEnd(e.target.value)}
            className="bb-focusable"
            style={{ ...inputStyle(), width: 140 }}
          />
        </label>
        <button
          type="button"
          data-testid="search-bar-clear"
          onClick={handleClear}
          className="bb-focusable bb-action"
          style={{
            background: 'transparent',
            border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
            color: BLACKBOARD_OKLCH_THEME.muted.oklch,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            cursor: 'pointer',
            minWidth: 24,
            minHeight: 24,
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Filter a post list against a `BlackboardFilter`. Pure — no mutation,
 * no side effects. Returns a new immutable array.
 */
export function applyFilter(
  posts: ReadonlyArray<BlackboardPost>,
  filter: BlackboardFilter,
): ReadonlyArray<BlackboardPost> {
  const q = filter.query.trim().toLowerCase();
  const startMs = filter.startDate ? Date.parse(filter.startDate) : Number.NEGATIVE_INFINITY;
  const endMs = filter.endDate ? Date.parse(`${filter.endDate}T23:59:59Z`) : Number.POSITIVE_INFINITY;
  return posts.filter((p) => {
    if (q) {
      const hay =
        `${p.body} ${p.author.name} ${p.region}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter.knowledgeStates.size > 0 && !filter.knowledgeStates.has(p.knowledgeState)) {
      return false;
    }
    if (filter.regions.size > 0 && !filter.regions.has(p.region)) {
      return false;
    }
    if (filter.authors.size > 0 && !filter.authors.has(p.author.id)) {
      return false;
    }
    const t = Date.parse(p.createdAt);
    if (!Number.isFinite(t)) return true;
    if (t < startMs || t > endMs) return false;
    return true;
  });
}
