/**
 * OwnerCommandPaletteMount — proves the palette rows are no longer
 * DEAD. The root layout mounted `OwnerCommandPalette` with NO
 * `onActionIntent` / `onSpawnTab` / `onSignOut`, so those rows were
 * silent no-ops on click. This test captures the callbacks the mount
 * passes down and asserts each does real work:
 *
 *   - onActionIntent parks a locale-resolved brain prompt (queued-prompt
 *     lib → sessionStorage) and opens the chat (borjie-open-chat event).
 *   - onSpawnTab parks a "spawn a {type} tab" prompt.
 *   - onSignOut calls supabase.auth.signOut + routes to /sign-in.
 *
 * RED baseline: with the pre-fix bare `<OwnerCommandPalette />` (no
 * callbacks), the captured props are undefined and every assertion
 * below throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// ── Capture the callbacks the mount hands to the palette ──
let captured: {
  onActionIntent?: (intent: string) => void;
  onSpawnTab?: (type: string) => void;
  onSignOut?: () => void;
} = {};

vi.mock('../OwnerCommandPalette', () => ({
  OwnerCommandPalette: (props: typeof captured) => {
    captured = props;
    return null;
  },
}));

// The listeners island touches window events on mount — render as null.
vi.mock('../SuperpowerListeners', () => ({
  SuperpowerListeners: () => null,
}));

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut } }),
}));

vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import { OwnerCommandPaletteMount } from '../OwnerCommandPaletteMount';
import { takeQueuedPrompt } from '@/lib/owner-os/queued-prompt';

beforeEach(() => {
  captured = {};
  replace.mockClear();
  refresh.mockClear();
  signOut.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('OwnerCommandPaletteMount — working callbacks', () => {
  it('onActionIntent parks a locale-resolved prompt and opens chat', () => {
    render(<OwnerCommandPaletteMount languagePreference="en" />);
    const opened = vi.fn();
    window.addEventListener('borjie-open-chat', opened);

    expect(captured.onActionIntent).toBeTypeOf('function');
    captured.onActionIntent!('create-reminder');

    expect(takeQueuedPrompt()).toBe('Create a reminder for me.');
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('borjie-open-chat', opened);
  });

  it('onActionIntent resolves the SW prompt when locale is sw', () => {
    render(<OwnerCommandPaletteMount languagePreference="sw" />);
    captured.onActionIntent!('create-reminder');
    expect(takeQueuedPrompt()).toBe('Nitengenezee kikumbusho.');
  });

  it('onActionIntent ignores an unknown intent (no prompt parked)', () => {
    render(<OwnerCommandPaletteMount languagePreference="en" />);
    captured.onActionIntent!('nonsense-intent');
    expect(takeQueuedPrompt()).toBeNull();
  });

  it('onSpawnTab parks a spawn prompt for the given type', () => {
    render(<OwnerCommandPaletteMount languagePreference="en" />);
    expect(captured.onSpawnTab).toBeTypeOf('function');
    captured.onSpawnTab!('finance');
    expect(takeQueuedPrompt()).toBe('Spawn a finance tab for me.');
  });

  it('onSignOut signs out and routes to /sign-in', async () => {
    render(<OwnerCommandPaletteMount languagePreference="en" />);
    expect(captured.onSignOut).toBeTypeOf('function');
    captured.onSignOut!();
    // Let the async signOut chain settle.
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/sign-in');
  });
});
