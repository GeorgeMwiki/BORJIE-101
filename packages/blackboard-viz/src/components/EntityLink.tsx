'use client';

/**
 * EntityLink — clickable @user / #region / $tool reference.
 *
 * Dispatches a typed `CustomEvent('bb:entity-click', detail)` on the
 * window so host portals can hang a global handler (navigate, open a
 * sheet, pin a chip) without having to plumb a callback through every
 * post card. Also accepts an inline `onClick` prop for testing.
 *
 * Accessibility:
 *  - Renders as a `<button type="button">` so keyboard activation
 *    fires the same handler (Enter / Space).
 *  - The visible label includes the sigil so screen readers read
 *    "at" / "hash" / "dollar" plus the id.
 *  - Color is bound to the entity kind via OKLCH tokens; underline
 *    is preserved so color is not the only signal (WCAG 1.4.1).
 */

import type { CSSProperties } from 'react';

import type { EntityRef, BlackboardEntityClickEventDetail } from '../types';
import { BLACKBOARD_OKLCH_THEME } from '../themes/blackboard-oklch';

export interface EntityLinkProps {
  readonly entityRef: EntityRef;
  readonly originPostId: string;
  readonly onClick?: (detail: BlackboardEntityClickEventDetail) => void;
}

function colorForKind(kind: EntityRef['kind']): string {
  switch (kind) {
    case 'user':
      return BLACKBOARD_OKLCH_THEME.kindAction.oklch;
    case 'region':
      return BLACKBOARD_OKLCH_THEME.kindEvidence.oklch;
    case 'tool':
      return BLACKBOARD_OKLCH_THEME.kindDecision.oklch;
  }
}

function baseStyle(kind: EntityRef['kind']): CSSProperties {
  return {
    color: colorForKind(kind),
    background: 'transparent',
    border: 'none',
    padding: '0 2px',
    margin: 0,
    cursor: 'pointer',
    font: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  };
}

export function EntityLink({ entityRef, originPostId, onClick }: EntityLinkProps): JSX.Element {
  function handleClick(): void {
    const detail: BlackboardEntityClickEventDetail = {
      ref: entityRef,
      originPostId,
    };
    if (onClick) onClick(detail);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<BlackboardEntityClickEventDetail>('bb:entity-click', {
          detail,
        }),
      );
    }
  }

  return (
    <button
      type="button"
      data-testid={`entity-link-${entityRef.kind}-${entityRef.id}`}
      data-entity-kind={entityRef.kind}
      data-entity-id={entityRef.id}
      aria-label={`${entityRef.kind} ${entityRef.id}`}
      onClick={handleClick}
      className="bb-focusable"
      style={baseStyle(entityRef.kind)}
    >
      {entityRef.label}
    </button>
  );
}
