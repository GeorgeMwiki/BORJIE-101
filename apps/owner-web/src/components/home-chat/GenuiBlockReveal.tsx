'use client';

/**
 * GenuiBlockReveal — mounts the shared 37-primitive `AdaptiveRenderer`
 * in the OWNER cockpit chat with an a11y-correct STAGED reveal.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The owner home-chat teach stream (`/api/v1/brain/teach`) emits
 * `<ui_block>` frames. `UiBlockRenderer` renders the five bespoke TEACH
 * blocks (concept_card, metric_strip, decision_card, step_progress,
 * micro_lesson) and DROPS everything else on the `default: return null`
 * branch. So any richer artifact the brain emits — a KPI grid, a chart,
 * a data table, a comparison — was silently discarded in the owner
 * cockpit even though admin's JarvisConsole renders exactly those payloads
 * through `@borjie/genui`'s `AdaptiveRenderer`.
 *
 * This component closes that gap: when a block's `type` is a genui
 * primitive `kind`, it routes through the SAME `AdaptiveRenderer` +
 * `GENUI_REGISTRY` admin uses, so the owner cockpit renders the full rich
 * interactive vocabulary (kpi tiles, charts, tables, comparisons, …).
 *
 * STAGED REVEAL (choreography)
 * ────────────────────────────
 * The entrance is choreographed via `@borjie/genui`'s `useChoreography`
 * (the first real consumer of the previously-dark `choreography-engine`)
 * plus the design-system `Reveal` primitive. `useReducedMotion` drives
 * the a11y path: under reduced motion the choreography reveals instantly
 * (no rAF frames) and `Reveal` renders in its resting state with no
 * transition — nothing animates.
 */

import type { ReactElement } from 'react';
import {
  AdaptiveRenderer,
  GENUI_KINDS,
  useChoreography,
  staggeredReveal,
  type AgUiUiPart,
} from '@borjie/genui';
import { Reveal, useReducedMotion } from '@borjie/design-system';
import { reportGenuiUnknownKind } from '@/lib/genui-telemetry';

/** Runtime set of every genui primitive `kind` the registry can render. */
const GENUI_KIND_SET: ReadonlySet<string> = new Set(GENUI_KINDS);

/**
 * True when `type` names one of the 37 shared genui primitives (and is
 * therefore an `AgUiUiPart.kind`), NOT a bespoke teach block type.
 */
export function isGenuiKind(type: string | undefined): boolean {
  return typeof type === 'string' && GENUI_KIND_SET.has(type);
}

/**
 * Adapt a teach `ui_block` whose `type` is a genui kind onto the
 * `AgUiUiPart` shape (`{ kind, ...rest }`). The block already carries the
 * primitive's fields inline; we only re-key `type` → `kind`. Each
 * primitive Zod-validates its own payload at the render boundary and the
 * dispatcher re-validates via `PART_SCHEMAS`, so a malformed payload
 * degrades to `UnknownKindCard` rather than crashing.
 */
function toUiPart(block: { readonly type: string; readonly [k: string]: unknown }): AgUiUiPart {
  const { type, ...rest } = block;
  return { kind: type, ...rest } as unknown as AgUiUiPart;
}

interface GenuiBlockRevealProps {
  /** The parsed teach block whose `type` is a genui primitive kind. */
  readonly block: { readonly type: string; readonly [k: string]: unknown };
  /** Stable id for the choreography reveal target (per message). */
  readonly targetId: string;
}

/**
 * Render one genui-kind block through `AdaptiveRenderer`, gated on a
 * single-target staggered choreography so the artifact reveals with a
 * short entrance (instant under reduced motion).
 */
export function GenuiBlockReveal({
  block,
  targetId,
}: GenuiBlockRevealProps): ReactElement {
  const reduced = useReducedMotion();
  // One artifact per bubble today, but the choreography is list-shaped so
  // multi-artifact reveals compose without touching this call site.
  const choreo = staggeredReveal([targetId]);
  const { isRevealed } = useChoreography(choreo, { reduced });
  const shown = isRevealed(targetId);

  const uiPart = toUiPart(block);

  return (
    <div className="mt-3" data-testid="owner-genui-block">
      {shown ? (
        <Reveal direction="up" duration="slow">
          <AdaptiveRenderer
            uiPart={uiPart}
            onUnknownKind={(detail) =>
              reportGenuiUnknownKind(detail, 'owner-home-chat')
            }
          />
        </Reveal>
      ) : (
        // Pre-reveal placeholder keeps layout height stable for a frame
        // before the choreography unveils the artifact.
        <div aria-hidden className="h-0" data-testid="owner-genui-block-pending" />
      )}
    </div>
  );
}
