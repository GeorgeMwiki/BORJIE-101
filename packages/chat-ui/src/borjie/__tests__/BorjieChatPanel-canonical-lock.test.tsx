/**
 * BorjieChatPanel — canonical display lock.
 *
 * The chat-panel header is the most visible persona surface. Per the
 * locked canonical-display contract it renders the short
 * `MR_MWIKILA_CANONICAL_DISPLAY.name` + `headerRole` (active locale), and
 * keeps the long single-string identity (`name_full`) only as the dialog's
 * accessible name. It must NEVER render the internal specialisation name /
 * subtitle. See:
 *   - Docs/DESIGN/CAPABILITIES_UNIFICATION.md "User-facing identity is locked"
 *   - packages/chat-ui/src/canonical-display.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  BORJIE_BRAND_EN,
  BORJIE_INTRO_EN,
  BorjieChatPanel,
} from '../BorjieChatPanel';
import { MR_MWIKILA_CANONICAL_DISPLAY } from '../../canonical-display.js';
import type { UseBorjieChatResult } from '../useBorjieChat';

function emptyChat(): UseBorjieChatResult {
  return {
    messages: [],
    isStreaming: false,
    error: null,
    send: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    retranslate: vi.fn().mockResolvedValue(undefined),
  };
}

const SPECIALISATION_LEAK_SIGNALS: ReadonlyArray<string> = [
  'Specialist',
  'Advisor',
  'Officer',
  'Concierge',
  'Junior',
  'subtitle',
];

describe('BorjieChatPanel — canonical display lock', () => {
  afterEach(() => {
    cleanup();
  });

  it('exports BORJIE_BRAND_EN sourced from MR_MWIKILA_CANONICAL_DISPLAY.name_full', () => {
    expect(BORJIE_BRAND_EN).toBe(MR_MWIKILA_CANONICAL_DISPLAY.name_full);
  });

  it('renders the canonical name + headerRole in the panel header (English)', () => {
    render(
      <BorjieChatPanel
        chat={emptyChat()}
        mode="build"
        language="en"
        onChangeMode={vi.fn()}
        onChangeLanguage={vi.fn()}
        onClose={vi.fn()}
        variant="floating"
        authenticated
        onSend={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const panel = screen.getByTestId('borjie-chat-panel');
    // The long single-string identity stays as the dialog's accessible name.
    expect(panel.getAttribute('aria-label')).toBe(
      MR_MWIKILA_CANONICAL_DISPLAY.name_full,
    );
    // The VISIBLE header renders the short name + role line, not the long
    // brochure sentence.
    const text = panel.textContent ?? '';
    expect(text).toContain(MR_MWIKILA_CANONICAL_DISPLAY.name);
    expect(text).toContain(MR_MWIKILA_CANONICAL_DISPLAY.headerRole.en);
  });

  it('renders the Swahili headerRole when language is sw', () => {
    render(
      <BorjieChatPanel
        chat={emptyChat()}
        mode="build"
        language="sw"
        onChangeMode={vi.fn()}
        onChangeLanguage={vi.fn()}
        onClose={vi.fn()}
        variant="floating"
        authenticated
        onSend={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const panel = screen.getByTestId('borjie-chat-panel');
    const text = panel.textContent ?? '';
    expect(text).toContain(MR_MWIKILA_CANONICAL_DISPLAY.headerRole.sw);
    // Single language per active locale: no EN role leaks into the SW header.
    expect(text).not.toContain(MR_MWIKILA_CANONICAL_DISPLAY.headerRole.en);
  });

  it('intro greeting embeds the canonical name_full', () => {
    expect(BORJIE_INTRO_EN).toContain(MR_MWIKILA_CANONICAL_DISPLAY.name_full);
  });

  it('panel header text never contains an internal specialisation subtitle', () => {
    render(
      <BorjieChatPanel
        chat={emptyChat()}
        mode="build"
        language="en"
        onChangeMode={vi.fn()}
        onChangeLanguage={vi.fn()}
        onClose={vi.fn()}
        variant="floating"
        authenticated
        onSend={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const panel = screen.getByTestId('borjie-chat-panel');
    const text = panel.textContent ?? '';
    for (const signal of SPECIALISATION_LEAK_SIGNALS) {
      expect(text).not.toContain(signal);
    }
  });
});
