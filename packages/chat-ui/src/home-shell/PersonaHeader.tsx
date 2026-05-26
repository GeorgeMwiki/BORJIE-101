/**
 * PersonaHeader — top-right header for HomeShell.
 *
 * Shows the canonical persona identity (name + title) and (optionally)
 * an "Open Dashboard" CTA. Subtle by design: it must not compete with
 * the conversation, but the user must always know who they are
 * talking to and how to escape into the workspace.
 *
 * Display identity is locked — the header always renders
 * `MR_MWIKILA_CANONICAL_DISPLAY.name` over `.title`, regardless of
 * which internal specialisation routed the turn. See
 * `Docs/DESIGN/CAPABILITIES_UNIFICATION.md` "User-facing identity is
 * locked" for the invariant. The `ResolvedAgent.display_name` and
 * `.title` props are still threaded through the component for legacy
 * call-sites + admin-portal overrides, but the chat surface ignores
 * them in favour of the canonical strings.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import type { CSSProperties } from 'react';
// Display identity is locked — see CAPABILITIES_UNIFICATION.md
// "User-facing identity is locked".
import { MR_MWIKILA_CANONICAL_DISPLAY } from '../canonical-display.js';
import type { ResolvedAgent } from './types.js';

export interface PersonaHeaderProps {
  readonly agent: ResolvedAgent;
  readonly enable_dashboard_link: boolean;
  readonly onOpenDashboard?: (() => void) | undefined;
  readonly testId?: string | undefined;
}

const HEADER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  borderRadius: 12,
  background: 'rgba(15, 23, 42, 0.04)',
  fontFamily: 'inherit',
  fontSize: 13,
  zIndex: 20,
};

const NAME_STYLE: CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-foreground, #0f172a)',
};

const TITLE_STYLE: CSSProperties = {
  fontWeight: 400,
  color: 'var(--color-muted-foreground, #475569)',
};

const BUTTON_STYLE: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-accent, #8B6914)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: 6,
};

export function PersonaHeader(props: PersonaHeaderProps): JSX.Element {
  const {
    agent: _agent,
    enable_dashboard_link,
    onOpenDashboard,
    testId = 'home-persona-header',
  } = props;
  // Display identity is locked to MR_MWIKILA_CANONICAL_DISPLAY. The
  // `agent` prop is retained for legacy call-sites + admin-portal
  // overrides (it still threads through the data model so audit logs
  // and routing logic can read the active specialisation), but the
  // user-facing chat surface never renders it — every header reads
  // the single canonical string. See CAPABILITIES_UNIFICATION.md
  // "User-facing identity is locked".
  void _agent;
  return (
    <div data-testid={testId} style={HEADER_STYLE} role="banner">
      <span style={NAME_STYLE}>{MR_MWIKILA_CANONICAL_DISPLAY.name}</span>
      <span style={TITLE_STYLE}>— {MR_MWIKILA_CANONICAL_DISPLAY.title}</span>
      {enable_dashboard_link && onOpenDashboard ? (
        <button
          type="button"
          data-testid="home-persona-header-dashboard"
          onClick={onOpenDashboard}
          style={BUTTON_STYLE}
        >
          Open Dashboard
        </button>
      ) : null}
    </div>
  );
}
