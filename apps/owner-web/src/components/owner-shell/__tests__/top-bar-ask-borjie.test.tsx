/**
 * TopBar "Ask Borjie" CTA — proves the primary owner-page control is no
 * longer DEAD. The button used to dispatch `borjie-open-widget`, but the
 * floating chat widget (packages/chat-ui Widget) and the command palette
 * both listen ONLY for `borjie-open-chat`. So the CTA on every owner page
 * fired an event nobody consumed — a silent no-op.
 *
 * RED baseline: with the pre-fix `new CustomEvent('borjie-open-widget')`,
 * the `borjie-open-chat` listener below never fires and the assertion
 * throws.
 */

import { describe, it, expect, vi } from 'vitest';

// TopBar transitively imports SignOutButton → @/lib/sentry, which boots
// the real Pino logger (no pino-pretty target under jsdom). Stub it — this
// test only exercises the two pure event helpers, not sign-out telemetry.
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import {
  OPEN_CHAT_EVENT,
  dispatchOpenChat,
} from '../TopBar';

describe('TopBar — Ask Borjie CTA opens the chat', () => {
  it('exposes the canonical widget event name', () => {
    expect(OPEN_CHAT_EVENT).toBe('borjie-open-chat');
  });

  it('dispatchOpenChat fires the event the chat widget consumes', () => {
    const opened = vi.fn();
    window.addEventListener('borjie-open-chat', opened);

    dispatchOpenChat();

    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('borjie-open-chat', opened);
  });

  it('does NOT fire the stale borjie-open-widget event', () => {
    const stale = vi.fn();
    window.addEventListener('borjie-open-widget', stale);

    dispatchOpenChat();

    expect(stale).not.toHaveBeenCalled();
    window.removeEventListener('borjie-open-widget', stale);
  });
});
