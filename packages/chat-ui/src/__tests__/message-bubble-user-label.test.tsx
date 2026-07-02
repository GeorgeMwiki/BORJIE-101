/**
 * MessageBubble user-label locale wiring.
 *
 * The floating widget carries no i18n dictionary, so the author tag on the
 * user's own row was previously an unconditional English 'You' — which
 * rendered English over a Swahili surface (a zero-mix violation). The label
 * must follow the active locale (`resolvedLanguage`): sw → 'Wewe', en →
 * 'You'. The active locale is `inlineLanguage` when supplied, else the
 * message's own `language` — mirroring the degraded-banner copy resolution.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../widget/MessageBubble';
import type { ChatMessage } from '../widget/types';

const baseUser: ChatMessage = {
  id: 'u-1',
  role: 'user',
  text: 'onyesha mtiririko wa fedha',
  language: 'en',
  createdAt: '2026-05-21T10:00:00Z',
};

describe('MessageBubble user label (locale-aware)', () => {
  it('renders English "You" for the user row under en', () => {
    render(
      <MessageBubble
        message={{ ...baseUser, language: 'en' }}
        personaName="Mr. Mwikila"
      />,
    );
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Wewe')).not.toBeInTheDocument();
  });

  it('renders Swahili "Wewe" for the user row under sw (no English leak)', () => {
    render(
      <MessageBubble
        message={{ ...baseUser, language: 'sw' }}
        personaName="Bw. Mwikila"
      />,
    );
    expect(screen.getByText('Wewe')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('prefers the inlineLanguage override for the user label', () => {
    render(
      <MessageBubble
        message={{ ...baseUser, language: 'en' }}
        personaName="Bw. Mwikila"
        inlineLanguage="sw"
      />,
    );
    expect(screen.getByText('Wewe')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('shows the persona name (not the user label) on assistant rows', () => {
    render(
      <MessageBubble
        message={{ ...baseUser, role: 'mwikila', language: 'sw' }}
        personaName="Bw. Mwikila"
      />,
    );
    expect(screen.getByText('Bw. Mwikila')).toBeInTheDocument();
    expect(screen.queryByText('Wewe')).not.toBeInTheDocument();
  });
});
