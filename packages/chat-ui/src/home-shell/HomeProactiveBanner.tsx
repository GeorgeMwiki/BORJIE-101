/**
 * HomeProactiveBanner — docked proactive-proposal slot for HomeShell.
 *
 * Renders pending tab-spawn proposals (and other proactive surfaces in
 * future) docked under the persona header. The user can accept or
 * dismiss without losing conversation state.
 *
 * The component intentionally mirrors the shape of NeedSpawnBanner
 * without coupling — HomeShell adapts proactive proposals to the
 * lighter ProactiveProposal shape declared in `./types.ts`. Apps that
 * already render NeedSpawnBanner in the Dashboard tab can keep doing
 * so; this banner is the Home-tab equivalent.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import type { CSSProperties } from 'react';
import type { ProactiveProposal } from './types.js';

export interface HomeProactiveBannerProps {
  readonly proposals: ReadonlyArray<ProactiveProposal>;
  readonly onAccept?: ((proposal_id: string) => void) | undefined;
  readonly onDismiss?: ((proposal_id: string) => void) | undefined;
  readonly testId?: string | undefined;
}

const WRAPPER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 64,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(720px, calc(100% - 32px))',
  zIndex: 15,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const CARD_STYLE: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  background: 'var(--color-card, #fffbeb)',
  border: '1px solid var(--color-border, #fde68a)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--color-foreground, #0f172a)',
  boxShadow: '0 6px 16px rgba(15, 23, 42, 0.08)',
};

const TITLE_STYLE: CSSProperties = {
  fontWeight: 600,
};

const RATIONALE_STYLE: CSSProperties = {
  color: 'var(--color-muted-foreground, #475569)',
  marginLeft: 4,
};

const BTN_STYLE: CSSProperties = {
  marginLeft: 'auto',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: 6,
};

export function HomeProactiveBanner(
  props: HomeProactiveBannerProps,
): JSX.Element | null {
  const {
    proposals,
    onAccept,
    onDismiss,
    testId = 'home-proactive-banner',
  } = props;

  if (proposals.length === 0) return null;

  return (
    <div data-testid={testId} style={WRAPPER_STYLE} role="status">
      {proposals.slice(0, 3).map((p) => (
        <div
          key={p.id}
          data-testid={`home-proactive-banner-${p.id}`}
          style={CARD_STYLE}
        >
          <span style={TITLE_STYLE}>{p.title}</span>
          <span style={RATIONALE_STYLE}>{p.rationale}</span>
          {onAccept ? (
            <button
              type="button"
              data-testid={`home-proactive-banner-${p.id}-accept`}
              onClick={() => onAccept(p.id)}
              style={{ ...BTN_STYLE, color: 'var(--color-accent, #8B6914)' }}
            >
              Accept
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              data-testid={`home-proactive-banner-${p.id}-dismiss`}
              onClick={() => onDismiss(p.id)}
              style={{ ...BTN_STYLE, color: 'var(--color-muted-foreground, #64748b)' }}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
