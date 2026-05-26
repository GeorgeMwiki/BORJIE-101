/**
 * PersonaHeader — top-right header for HomeShell.
 *
 * Shows the resolved persona's name + title and (optionally) an
 * "Open Dashboard" CTA. Subtle by design: it must not compete with
 * the conversation, but the user must always know who they are
 * talking to and how to escape into the workspace.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import type { CSSProperties } from 'react';
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
    agent,
    enable_dashboard_link,
    onOpenDashboard,
    testId = 'home-persona-header',
  } = props;
  return (
    <div data-testid={testId} style={HEADER_STYLE} role="banner">
      <span style={NAME_STYLE}>{agent.display_name}</span>
      <span style={TITLE_STYLE}>— {agent.title}</span>
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
