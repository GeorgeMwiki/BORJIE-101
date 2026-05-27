import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { EntityLink } from '../components/EntityLink';
import { parseEntities } from '../components/entity-parser';
import type { BlackboardEntityClickEventDetail } from '../types';

describe('EntityLink', () => {
  it('emits a typed BlackboardEntityClickEvent on click', () => {
    const events: BlackboardEntityClickEventDetail[] = [];
    const listener = ((ev: Event) => {
      events.push((ev as CustomEvent<BlackboardEntityClickEventDetail>).detail);
    }) as EventListener;
    window.addEventListener('bb:entity-click', listener);
    render(
      <EntityLink
        entityRef={{ kind: 'region', id: 'pit-b', label: '#pit-b' }}
        originPostId="p1"
      />,
    );
    fireEvent.click(screen.getByTestId('entity-link-region-pit-b'));
    expect(events.at(-1)).toMatchObject({
      ref: { kind: 'region', id: 'pit-b' },
      originPostId: 'p1',
    });
    window.removeEventListener('bb:entity-click', listener);
  });

  it('parses @user, #region, and $tool tokens from a body', () => {
    const tokens = parseEntities('Hello @mwikila — see #pit-b for $haul-policy.');
    const kinds = tokens.map((t) => (t.kind === 'ref' ? t.ref.kind : 'text'));
    expect(kinds).toContain('user');
    expect(kinds).toContain('region');
    expect(kinds).toContain('tool');
  });

  it('fires the inline onClick handler as well as the global event', () => {
    const onClick = vi.fn();
    render(
      <EntityLink
        entityRef={{ kind: 'user', id: 'mwikila', label: '@mwikila' }}
        originPostId="p1"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('entity-link-user-mwikila'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
