'use client';

/**
 * `BlackboardVizBlock` — the GenUI dispatcher for a `kind: 'blackboard'`
 * UI part. The block is consumed by `@borjie/genui`'s `AdaptiveRenderer`
 * and mounts the matching view component.
 *
 * Selection rules:
 *   - view: 'timeline'   → TimelineView
 *   - view: 'threaded'   → ThreadedView
 *   - view: 'kanban'     → KanbanView (read-only by default)
 *   - view: 'tree-graph' → TreeGraphView
 *   - undefined           → TimelineView (the safe default)
 *
 * The block validates its payload via Zod as defense-in-depth and
 * surfaces a `role="alert"` fallback on malformed input, exactly
 * matching the `graph-viz` block convention.
 *
 * Spec: `Docs/DESIGN/BLACKBOARD_VIZ_SOTA_2026.md` §6.
 */

import type { CSSProperties } from 'react';

import type {
  BlackboardVizBlockPayload,
  BlackboardMutationAuthority,
  ViewProps,
} from '../types';
import { BlackboardVizBlockSchema } from '../types';
import { TimelineView } from '../views/TimelineView';
import { ThreadedView } from '../views/ThreadedView';
import { KanbanView } from '../views/KanbanView';
import { TreeGraphView } from '../views/TreeGraphView';

export interface BlackboardVizBlockProps {
  readonly payload: BlackboardVizBlockPayload | Record<string, unknown>;
  /** Optional injected mutation authority — required when `payload.mode === 'mutate'`. */
  readonly mutationAuthority?: BlackboardMutationAuthority;
  readonly testId?: string;
}

/**
 * Pure selector — exported so the test bench can assert which view is
 * chosen without touching the DOM.
 */
export function pickViewForPayload(payload: BlackboardVizBlockPayload):
  | 'timeline'
  | 'threaded'
  | 'kanban'
  | 'tree-graph' {
  return payload.view ?? 'timeline';
}

function malformedStyle(): CSSProperties {
  return {
    padding: 12,
    border: '1px dashed oklch(0.78 0.13 70)',
    borderRadius: 8,
    color: 'oklch(0.40 0.13 70)',
    fontSize: 12,
  };
}

function titleStyle(): CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 4px 0',
    color: 'oklch(0.20 0.02 60)',
  };
}

export function BlackboardVizBlock({
  payload,
  mutationAuthority,
  testId,
}: BlackboardVizBlockProps): JSX.Element {
  const parsed = BlackboardVizBlockSchema.safeParse(payload);
  if (!parsed.success) {
    return (
      <div
        role="alert"
        data-blackboard-viz-malformed="true"
        data-testid={testId ?? 'blackboard-viz-block-malformed'}
        style={malformedStyle()}
      >
        blackboard-viz: malformed payload — {parsed.error.issues[0]?.message ?? 'invalid'}
      </div>
    );
  }
  const value = parsed.data;
  const view = pickViewForPayload(value);
  const sharedProps: ViewProps = {
    posts: value.posts,
    mode: value.mode ?? 'readonly',
    ...(mutationAuthority ? { mutationAuthority } : {}),
  };

  return (
    <div
      data-testid={testId ?? 'blackboard-viz-block'}
      data-blackboard-view={view}
    >
      {value.title ? (
        <div
          data-testid="blackboard-viz-block-title"
          style={titleStyle()}
        >
          {value.title}
        </div>
      ) : null}
      {view === 'timeline' ? <TimelineView {...sharedProps} /> : null}
      {view === 'threaded' ? <ThreadedView {...sharedProps} /> : null}
      {view === 'kanban' ? <KanbanView {...sharedProps} /> : null}
      {view === 'tree-graph' ? <TreeGraphView {...sharedProps} /> : null}
    </div>
  );
}

export { BlackboardVizBlockSchema };
export type { BlackboardVizBlockPayload };
