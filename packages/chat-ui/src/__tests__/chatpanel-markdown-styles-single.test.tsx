/**
 * ChatPanel MarkdownStyles single-mount regression.
 *
 * `MarkdownStyles` emits an inline `<style>` block carrying the `borjie-md-*`
 * rules. It used to be mounted INSIDE every MessageBubble, so an N-message
 * conversation painted N identical `<style>` tags into the DOM (duplicate
 * stylesheet churn). The fix hoists a SINGLE `<MarkdownStyles/>` up to the
 * message-list container in ChatPanel, rendered once as a sibling of the
 * messages `.map()`. This test renders a multi-message panel and asserts the
 * markdown stylesheet appears EXACTLY ONCE regardless of message count.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ChatPanel } from '../widget/ChatPanel';
import type { ChatMessage, UnifiedChat, WidgetStrings } from '../widget/types';
import { DEFAULT_WIDGET_STRINGS_EN } from '../widget/types';

function makeMessage(id: string, role: ChatMessage['role']): ChatMessage {
  return {
    id,
    role,
    text: 'Here is `inline code` and a **bold** word.',
    language: 'en',
    createdAt: '2026-07-02T00:00:00.000Z',
  };
}

function makeChat(messageCount: number): UnifiedChat {
  const messages: ChatMessage[] = Array.from({ length: messageCount }, (_, i) =>
    makeMessage(`m${i}`, i % 2 === 0 ? 'user' : 'mwikila'),
  );
  return {
    messages,
    segments: [],
    mode: 'expanded',
    isStreaming: false,
    unreadCount: 0,
    language: 'en',
    persona: 'owner-advisor',
    route: {
      path: '/',
      portal: 'owner',
      entityMentions: [],
      activeSubPersona: 'general',
    },
    voiceEnabled: false,
    soundsEnabled: false,
    error: null,
    sessionId: 'sess_1',
    tenantId: 'tnt_estate_1',
    sendMessage: async () => undefined,
    switchMode: () => undefined,
    abort: () => undefined,
    setLanguage: () => undefined,
    toggleVoice: () => undefined,
    toggleSounds: () => undefined,
    clearUnread: () => undefined,
    startSegment: () => undefined,
  } as UnifiedChat;
}

function countMarkdownStyleTags(container: HTMLElement): number {
  return Array.from(container.querySelectorAll('style')).filter((s) =>
    (s.textContent ?? '').includes('.borjie-md-code'),
  ).length;
}

describe('ChatPanel — single MarkdownStyles mount', () => {
  const strings: WidgetStrings = DEFAULT_WIDGET_STRINGS_EN;

  it('renders exactly one markdown stylesheet for a multi-message conversation', () => {
    const view = render(
      <ChatPanel
        chat={makeChat(5)}
        strings={strings}
        onClose={() => undefined}
        variant="full"
      />,
    );
    expect(countMarkdownStyleTags(view.container)).toBe(1);
    view.unmount();
  });

  it('stays at one stylesheet even as the message count grows', () => {
    const view = render(
      <ChatPanel
        chat={makeChat(12)}
        strings={strings}
        onClose={() => undefined}
        variant="floating"
      />,
    );
    // 12 messages would have produced 12 <style> tags under the old per-bubble
    // mount; the hoist keeps it at exactly one.
    expect(countMarkdownStyleTags(view.container)).toBe(1);
    view.unmount();
  });
});
