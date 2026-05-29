'use client';

/**
 * BorjieDynamicHints — owner-web mount surface for the three chat-ui
 * dynamic-UI components (ProactiveHint, MasteryGate, LearnedShortcutsPanel).
 *
 * Per the DU-2/3/4 audit (`Docs/AUDIT/DYNAMIC_UI_ACTIVE_2026-05-29.md`)
 * the components themselves are REAL + ADAPTIVE + SOTA — they were just
 * not mounted in any app surface. This wrapper provides:
 *
 *   - ONE mount line for callers (`<BorjieDynamicHints language=… />`).
 *   - Bilingual sw/en wiring via the `@borjie/chat-ui` borjie
 *     catalogue (`borjieProactiveHints`, `borjieMasteryGateCopy`,
 *     `borjieLearnedShortcutsHeadline`) — fulfils CLAUDE.md sw-first
 *     hard rule.
 *   - Safe defaults so the mount renders nothing until backend data
 *     flows in: the affective profile starts null (no hint surfaces),
 *     the mastery score starts null (the gate hides), the learned
 *     shortcuts array starts empty (the panel hides).
 *   - A `proactive-hint:action` listener that bridges hint emits to
 *     the conventional Borjie chat dispatcher pattern; consumers can
 *     wire `onHintAction` to handle the four canonical TOM emits
 *     (handoff, explain-simpler, safety reassurance, teach Cmd-K).
 *
 * Mount call site discipline:
 *   HomeChat / HomeChatTeach add a single `<BorjieDynamicHints …/>`
 *   below their composer. Once #202's chat-handles-everything wave
 *   provides a live `useAffectiveProfile` getter and `useLearnedShortcuts`
 *   fetcher, those can be wired in via the props here without touching
 *   the call sites again.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  LearnedShortcutsPanel,
  MasteryGate,
  ProactiveHint,
  borjieLearnedShortcutsHeadline,
  borjieMasteryGateCopy,
  borjieProactiveHints,
  type HintCandidate,
  type LearnedShortcut,
  type MasteryLevel,
  type MasteryScore,
} from '@borjie/chat-ui';

/**
 * Subset of the chat-ui AffectiveProfile contract we re-use here. The
 * local re-declaration keeps owner-web independent of the chat-ui hook
 * package surface — we only need the shape to forward into
 * `<ProactiveHint />`. Mirrors
 * `packages/chat-ui/src/hooks/useAffectiveProfile.ts:35`.
 */
export interface BorjieAffectiveProfile {
  readonly frustration: number;
  readonly comprehension: number;
  readonly anxiety: number;
  readonly trust: number;
  readonly urgency: number;
  readonly lastUpdated: string;
}

export interface BorjieDynamicHintsProps {
  readonly language: 'sw' | 'en';
  /**
   * Live affective profile from the brain — when omitted the
   * ProactiveHint renders nothing (safe default until #202 wires
   * `useAffectiveProfile` into the chat surfaces).
   */
  readonly affectiveProfile?: BorjieAffectiveProfile | null;
  /**
   * Optional mastery score — when omitted the MasteryGate renders
   * nothing (treats as still-loading). Once a real score flows in via
   * `useUserMastery`, the gate decides whether to show its locked-state
   * hint or the gated children. We render the locked-state hint by
   * default; consumers that want gated children can wrap them here.
   */
  readonly masteryScore?: MasteryScore | null;
  /**
   * Required mastery level — defaults to `expert` so the locked-state
   * hint encourages owners to engage more before unlocking power-user
   * affordances (consistent with the rest of the cockpit).
   */
  readonly masteryLevel?: MasteryLevel;
  /**
   * Optional ranked shortcuts from `useLearnedShortcuts` — when empty
   * the panel renders nothing.
   */
  readonly learnedShortcuts?: ReadonlyArray<LearnedShortcut>;
  /**
   * Optional override for the ProactiveHint catalogue. When omitted the
   * Borjie default 4-hint catalogue (frustration handoff, comprehension
   * simpler, anxiety safety, idle Cmd-K) ships per the chat-ui audit.
   */
  readonly hints?: ReadonlyArray<HintCandidate>;
  /**
   * Click handler for the LearnedShortcutsPanel — receives the
   * shortcut id (e.g. `nav:portfolio.add-property`). Defaults to a no-op
   * so the panel still renders for visual review.
   */
  readonly onShortcutClick?: (id: string) => void;
  /**
   * Fired when ProactiveHint dispatches its `proactive-hint:action`
   * window event. Consumers switch/case on the action string —
   * NEVER `eval()` the value (see ProactiveHint JSDoc).
   */
  readonly onHintAction?: (hintId: string, action: string) => void;
}

const DEFAULT_LEVEL: MasteryLevel = 'expert';

export function BorjieDynamicHints({
  language,
  affectiveProfile = null,
  masteryScore = null,
  masteryLevel = DEFAULT_LEVEL,
  learnedShortcuts = [],
  hints,
  onShortcutClick,
  onHintAction,
}: BorjieDynamicHintsProps): JSX.Element {
  const hintCatalogue = useMemo<ReadonlyArray<HintCandidate>>(
    () => hints ?? borjieProactiveHints(language),
    [hints, language],
  );

  const gateCopy = useMemo(() => borjieMasteryGateCopy(language), [language]);
  const shortcutsHeadline = useMemo(
    () => borjieLearnedShortcutsHeadline(language),
    [language],
  );

  // Bridge the global `proactive-hint:action` event into the optional
  // `onHintAction` callback. Listener is no-op during SSR.
  const [bridged, setBridged] = useState(false);
  useEffect(() => {
    if (!onHintAction) return undefined;
    if (typeof window === 'undefined') return undefined;
    function handle(event: Event): void {
      const ev = event as CustomEvent<{ id?: string; action?: string }>;
      const id = ev.detail?.id ?? '';
      const action = ev.detail?.action ?? '';
      if (id && action && onHintAction) onHintAction(id, action);
    }
    window.addEventListener('proactive-hint:action', handle);
    setBridged(true);
    return () => {
      window.removeEventListener('proactive-hint:action', handle);
      setBridged(false);
    };
  }, [onHintAction]);

  const noopShortcutClick = useMemo(
    () => onShortcutClick ?? ((_id: string) => undefined),
    [onShortcutClick],
  );

  return (
    <div
      data-testid="borjie-dynamic-hints"
      data-language={language}
      data-bridged={bridged ? '1' : '0'}
      className="flex flex-col gap-2"
    >
      <ProactiveHint
        profile={affectiveProfile}
        hints={hintCatalogue}
        dismissAriaLabel={gateCopy.dismissAriaLabel}
      />
      <MasteryGate
        level={masteryLevel}
        score={masteryScore}
        hintTemplate={gateCopy.hintTemplate}
      >
        {null}
      </MasteryGate>
      <LearnedShortcutsPanel
        shortcuts={learnedShortcuts}
        onActionClick={noopShortcutClick}
        headline={shortcutsHeadline}
        placement="inline"
      />
    </div>
  );
}
