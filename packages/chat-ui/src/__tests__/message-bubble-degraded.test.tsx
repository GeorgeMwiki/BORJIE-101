/**
 * MessageBubble degraded-metadata wiring.
 *
 * The floating widget surfaces the kernel's `degraded` marker by
 * stashing it on `ChatMessage.metadata.degraded`. We verify the
 * bubble renders the shared `DegradedBanner` only for assistant
 * turns that carry a well-formed marker — every other shape (user
 * messages, missing metadata, malformed payloads) silently renders
 * no banner.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../widget/MessageBubble';
import type { ChatMessage } from '../widget/types';

const baseAssistant: ChatMessage = {
  id: 'm-1',
  role: 'mwikila',
  text: 'Here is the cashflow.',
  language: 'en',
  createdAt: '2026-05-21T10:00:00Z',
};

describe('MessageBubble degraded metadata', () => {
  it('renders the banner when metadata.degraded is well-formed', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      metadata: {
        degraded: {
          reason: 'sensor primary breaker open',
          affected_capabilities: ['sensor:primary'],
        },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.getByTestId('degraded-banner')).toBeInTheDocument();
  });

  it('does not render the banner on user messages even with metadata', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      role: 'user',
      text: 'show me cashflow',
      metadata: {
        degraded: {
          reason: 'r',
          affected_capabilities: ['x'],
        },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument();
  });

  it('renders no banner when metadata is missing', () => {
    render(<MessageBubble message={baseAssistant} personaName="Mr. Mwikila" />);
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument();
  });

  it('renders no banner when degraded payload is malformed (missing reason)', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      metadata: {
        degraded: { affected_capabilities: ['x'] },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument();
  });

  it('renders no banner when affected_capabilities is not an array', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      metadata: {
        degraded: {
          reason: 'r',
          affected_capabilities: 'sensor:primary',
        },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument();
  });

  it('renders no banner when an entry in affected_capabilities is non-string', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      metadata: {
        degraded: {
          reason: 'r',
          affected_capabilities: ['x', 7],
        },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument();
  });

  it('continues to render the bubble body alongside the banner', () => {
    const message: ChatMessage = {
      ...baseAssistant,
      metadata: {
        degraded: {
          reason: 'r',
          affected_capabilities: ['x'],
        },
      },
    };
    render(<MessageBubble message={message} personaName="Mr. Mwikila" />);
    expect(screen.getByTestId('message-bubble-body').textContent).toContain(
      'Here is the cashflow.',
    );
  });
});
