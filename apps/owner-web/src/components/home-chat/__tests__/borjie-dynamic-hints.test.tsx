/**
 * BorjieDynamicHints — mount-smoke tests.
 *
 * Covers the three "ACTIVE-pending-mount" wires from
 * `Docs/AUDIT/DYNAMIC_UI_ACTIVE_2026-05-29.md` (DU-2 / DU-3 / DU-4):
 *
 *   1. Renders without crash with default props (no profile, no score,
 *      no shortcuts) — the three components hide themselves gracefully.
 *   2. Renders the Borjie sw-first hint copy when a frustration profile
 *      is supplied.
 *   3. Renders the LearnedShortcutsPanel headline when shortcuts flow.
 *   4. Surfaces the MasteryGate locked-state hint when score is below
 *      the gate level.
 *   5. Bridges the global `proactive-hint:action` event into the
 *      optional `onHintAction` callback.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { MasteryScore } from '@borjie/chat-ui';
import {
  BorjieDynamicHints,
  type BorjieAffectiveProfile,
} from '../BorjieDynamicHints';

afterEach(() => {
  cleanup();
});

describe('BorjieDynamicHints', () => {
  it('renders the wrapper without crashing on default props', () => {
    render(<BorjieDynamicHints language="sw" />);
    const root = screen.getByTestId('borjie-dynamic-hints');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-language')).toBe('sw');
    // No score → MasteryGate hides. No shortcuts → panel hides.
    expect(screen.queryByTestId('mastery-gate-locked')).toBeNull();
    expect(screen.queryByTestId('learned-shortcuts-panel')).toBeNull();
    // The Borjie default ProactiveHint catalogue includes an `idle`
    // hint with threshold 0 that fires unconditionally — this is the
    // Cmd-K teaching hint per the catalogue contract.
    const hint = screen.getByTestId('proactive-hint');
    expect(hint.getAttribute('data-hint-trigger')).toBe('idle');
  });

  it('shows the frustration hint in Swahili when the profile fires', () => {
    const profile: BorjieAffectiveProfile = {
      frustration: 0.9,
      comprehension: 1,
      anxiety: 0,
      trust: 1,
      urgency: 0,
      lastUpdated: new Date().toISOString(),
    };
    render(
      <BorjieDynamicHints
        language="sw"
        affectiveProfile={profile}
      />,
    );
    const hint = screen.getByTestId('proactive-hint');
    expect(hint).toBeTruthy();
    expect(hint.getAttribute('data-hint-trigger')).toBe('frustration');
    expect(hint.textContent).toContain('Ongea na mtu');
  });

  it('shows the MasteryGate locked-state hint when below threshold', () => {
    const score: MasteryScore = {
      level: 'novice',
      totalActions: 1,
      distinctActions: 1,
      recencyWeight: 1,
      weightedScore: 1,
      nextThreshold: 5,
      nextLevel: 'intermediate',
    };
    render(
      <BorjieDynamicHints
        language="en"
        masteryScore={score}
        masteryLevel="expert"
      />,
    );
    const locked = screen.getByTestId('mastery-gate-locked');
    expect(locked).toBeTruthy();
    expect(locked.textContent).toContain('expert');
  });

  it('renders the Swahili shortcuts headline when shortcuts flow', () => {
    render(
      <BorjieDynamicHints
        language="sw"
        learnedShortcuts={[
          {
            id: 'nav.workforce',
            label: 'Wafanyakazi',
            confidence: 1,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('learned-shortcuts-panel')).toBeTruthy();
    expect(screen.getByText('Njia zako za mkato')).toBeTruthy();
  });

  it('bridges the proactive-hint:action window event to onHintAction', async () => {
    const onHintAction = vi.fn();
    render(
      <BorjieDynamicHints
        language="en"
        onHintAction={onHintAction}
      />,
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('proactive-hint:action', {
          detail: { id: 'borjie.idle.cmdk', action: 'borjie:teach:cmdk' },
        }),
      );
    });
    expect(onHintAction).toHaveBeenCalledWith(
      'borjie.idle.cmdk',
      'borjie:teach:cmdk',
    );
  });

  it('invokes onShortcutClick when a shortcut item is clicked', () => {
    const onShortcutClick = vi.fn();
    render(
      <BorjieDynamicHints
        language="en"
        onShortcutClick={onShortcutClick}
        learnedShortcuts={[
          {
            id: 'nav.workforce',
            label: 'Workforce',
            confidence: 1,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('learned-shortcut-nav.workforce'));
    expect(onShortcutClick).toHaveBeenCalledWith('nav.workforce');
  });
});
