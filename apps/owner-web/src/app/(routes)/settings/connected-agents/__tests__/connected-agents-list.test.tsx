/**
 * connected-agents-list — revoke failure toast is language-pure.
 *
 * RED→GREEN guard for track A7: on a failed revoke the toast MUST NOT
 * interpolate the raw (English) gateway response body. Under the `sw`
 * locale that would render a Swahili wrapper around an English body —
 * language MIXING, which the canon forbids. The failure reason is a
 * fully-localized, status-only fragment; the raw body is discarded.
 *
 * `useLocale` is stubbed to `sw` (the real hook re-reads the document
 * cookie in an effect, which is not deterministic in jsdom); the real
 * `pickByLocale` is preserved so we exercise the actual sw catalog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { ConnectedAgentsList } from '../connected-agents-list';

vi.mock('@/lib/csrf', () => ({
  getCsrfHeaders: (): Record<string, string> => ({}),
}));

vi.mock('@/lib/env-guard', () => ({
  requirePublicBaseUrl: (): string => 'http://gateway.test',
}));

vi.mock('@/lib/locale', async () => {
  const actual = await vi.importActual<typeof import('@/lib/locale')>(
    '@/lib/locale',
  );
  return { ...actual, useLocale: () => 'sw' as const };
});

// A raw English gateway body that must NEVER appear in the sw toast.
const ENGLISH_BODY = 'Internal Server Error: token already revoked';

const token = {
  id: 'tok_1',
  clientId: 'client_abc',
  clientLabel: 'Test Agent',
  scopes: ['read'],
  issuedAt: new Date().toISOString(),
  lastUsedAt: null,
  expiresAt: null,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/oauth/agent-tokens') && init?.method == null) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [token] }),
        } as unknown as Response;
      }
      // The revoke POST fails with a raw English body + 500.
      return {
        ok: false,
        status: 500,
        text: async () => ENGLISH_BODY,
        json: async () => ({}),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ConnectedAgentsList revoke failure toast (sw)', () => {
  it('renders a pure-Swahili failure toast with no interpolated English body', async () => {
    await act(async () => {
      render(<ConnectedAgentsList initialLocale="sw" />);
    });

    // Open the confirmation and confirm the revoke.
    const revokeBtn = await screen.findByRole('button', { name: 'Ondoa' });
    await act(async () => {
      fireEvent.click(revokeBtn);
    });
    const confirmBtn = screen
      .getAllByRole('button', { name: 'Ondoa' })
      .at(-1)!;
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    const toast = await screen.findByText(/Jaribu tena/);
    const text = toast.textContent ?? '';

    // The Swahili wrapper is present…
    expect(text).toContain('Tatizo');
    expect(text).toContain('Jaribu tena');
    // …and the raw English gateway body is absent (no language mixing).
    expect(text).not.toContain(ENGLISH_BODY);
    expect(text).not.toContain('Internal Server Error');
    expect(text).not.toContain('token already revoked');
    // The localized status-only fragment carries the numeric status.
    expect(text).toContain('500');
  });
});
