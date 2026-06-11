'use client';

/**
 * `ActionButton` — the ONE canonical action component.
 *
 * Three byte-identical implementations exist in owner-web today
 * (GenUIWidgetRenderer, ArtifactProposalHost, and the inline-action path).
 * This is their single home. It implements the SOTA intent-mediation rule
 * (MCP-UI: a widget EMITS intents, never mutates) by handing every click
 * to the host's `onAction` port:
 *
 *   - a KNOWN verb routes to a governed handler → `executed` (terminal);
 *   - an UNKNOWN / generative verb routes to the brain via the
 *     `deferToBrain` seam → `handling` while the brain fulfills it under
 *     the policy gate + audit (the generative-wiring principle: an unknown
 *     verb is FULFILLED, never dropped on a static allowlist).
 *
 * The state machine is exactly the one the three copies converge on:
 *
 *   idle → (click) → pending
 *     pending → executed   → done       (known verb ran)
 *     pending → deferToBrain → handling  (brain is fulfilling)
 *     pending → declined   → declined    (owner / policy gate said no)
 *     pending → failed     → failed      (retryable)
 *
 * The component authorizes NOTHING itself — it only renders + dispatches.
 * The host's `onAction` is the authoritative boundary (policy gate,
 * four-eyes, kill-switch, immutable ledger). Locale-safe: the `label` is
 * brain-authored in the active locale; status copy is host-provided via
 * the optional `statusLabels` so no English string is hard-coded here.
 */

import { useCallback, useState } from 'react';
import type {
  ArtifactAction,
  ArtifactActionPort,
  ArtifactActionResult,
} from './host-context.js';

/** The button's externally-visible state. */
export type ActionButtonState =
  | 'idle'
  | 'pending'
  | 'done'
  | 'handling'
  | 'declined'
  | 'failed';

/**
 * Host-provided status copy, so the button never hard-codes a locale
 * string (the absolute en/sw separation invariant). Omitted entries fall
 * back to the brain-authored `action.label`, never to an English literal.
 */
export interface ActionButtonStatusLabels {
  readonly pending?: string;
  readonly done?: string;
  readonly handling?: string;
  readonly declined?: string;
  readonly failed?: string;
}

export interface ActionButtonProps {
  /** The action intent — `{ id, label, verb, params }`. */
  readonly action: ArtifactAction;
  /** The host action membrane (known → handler / unknown → deferToBrain). */
  readonly onAction: ArtifactActionPort;
  /** Optional host-localised status copy. */
  readonly statusLabels?: ActionButtonStatusLabels;
  /** Optional className passthrough for host theming. */
  readonly className?: string;
  /**
   * Optional terminal callback — fired once the dispatch settles to a
   * terminal state, so the host can chain (e.g. refetch a binding).
   */
  readonly onSettled?: (result: ArtifactActionResult) => void;
}

/** Map a settled `onAction` result to the button's display state. */
function stateForResult(result: ArtifactActionResult): ActionButtonState {
  switch (result.status) {
    case 'executed':
      return 'done';
    case 'deferToBrain':
      return 'handling';
    case 'declined':
      return 'declined';
    case 'failed':
      return 'failed';
    default:
      // Reachability-complete: an unknown status degrades to `failed`
      // (retryable) rather than throwing.
      return 'failed';
  }
}

export function ActionButton({
  action,
  onAction,
  statusLabels,
  className,
  onSettled,
}: ActionButtonProps): JSX.Element {
  const [state, setState] = useState<ActionButtonState>('idle');

  const handleClick = useCallback(async () => {
    if (state === 'pending' || state === 'handling') return;
    setState('pending');
    try {
      const result = await onAction(action);
      setState(stateForResult(result));
      onSettled?.(result);
    } catch (error) {
      // Defensive: a thrown host handler must not crash the surface. The
      // host owns logging (pino, no console here); we degrade to `failed`.
      setState('failed');
      onSettled?.({
        status: 'failed',
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }, [action, onAction, onSettled, state]);

  const label = labelForState(state, action.label, statusLabels);
  const isBusy = state === 'pending' || state === 'handling';
  const isTerminalNonRetry = state === 'done';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isBusy || isTerminalNonRetry}
      aria-busy={isBusy}
      data-artifact-action-id={action.id}
      data-artifact-action-verb={action.verb}
      data-artifact-action-state={state}
      className={className}
    >
      {label}
    </button>
  );
}

/**
 * Resolve the display label for a state. Falls back to the brain-authored
 * `actionLabel` (locale-correct) when the host did not provide status copy
 * — never to an English literal.
 */
function labelForState(
  state: ActionButtonState,
  actionLabel: string,
  statusLabels?: ActionButtonStatusLabels,
): string {
  switch (state) {
    case 'pending':
      return statusLabels?.pending ?? actionLabel;
    case 'done':
      return statusLabels?.done ?? actionLabel;
    case 'handling':
      return statusLabels?.handling ?? actionLabel;
    case 'declined':
      return statusLabels?.declined ?? actionLabel;
    case 'failed':
      return statusLabels?.failed ?? actionLabel;
    case 'idle':
    default:
      return actionLabel;
  }
}
