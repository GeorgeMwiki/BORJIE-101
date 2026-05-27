/**
 * HomeChat (admin-web chat-first home) — render + interaction smoke tests.
 *
 * Covers:
 *   1. Persona greeting renders with the four suggestion chips when the
 *      transcript is empty.
 *   2. Clicking a chip kicks a brain turn — i.e. the gateway is called
 *      with the chip prompt + the forced admin persona id.
 *   3. After a successful turn the assistant bubble renders the response
 *      text and the tool-call list appears in the sidebar.
 *   4. PersonaGreeting suggestion list exposes the right four Swahili
 *      labels (Onyesha tenants, Kill-switch, Sentry pilot, Audit chain).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { HomeChat } from '@/components/home-chat/HomeChat';
import {
  ADMIN_SUGGESTIONS,
  PersonaGreeting,
} from '@/components/home-chat/PersonaGreeting';

// next/navigation: jsdom does not load the Next runtime, so we stub the
// router hooks to no-ops that simply return a search-params-like shape.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () =>
    ({
      get: () => null,
    }) as unknown as URLSearchParams,
}));

// Stub the Supabase browser client so `authHeaders()` does not touch the
// network or env vars during render.
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

function mockGatewayOnce(body: unknown, status = 200) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('HomeChat · empty state', () => {
  it('renders the persona greeting with all four suggestion chips', () => {
    render(<HomeChat />);
    expect(screen.getByTestId('home-chat-greeting')).toBeTruthy();
    for (const chip of ADMIN_SUGGESTIONS) {
      expect(
        screen.getByTestId(`home-chat-chip-${chip.id}`),
      ).toBeTruthy();
    }
  });

  it('renders the composer with the admin placeholder copy', () => {
    render(<HomeChat />);
    const composer = screen.getByTestId('home-chat-composer');
    expect(composer).toBeTruthy();
    const textarea = composer.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute('placeholder')).toContain(
      'Swahili or English',
    );
  });
});

describe('HomeChat · suggestion chip dispatches a turn', () => {
  it('forwards the chip prompt + forced persona to POST /brain/turn', async () => {
    const fetchSpy = mockGatewayOnce({
      threadId: 'thr_chip',
      finalPersonaId: 'T2_admin_strategist',
      responseText: 'Tenants 10 wapya zimepatikana.',
      handoffs: [],
      toolCalls: [
        {
          name: 'TenantDirectory',
          status: 'ok',
          latencyMs: 42,
        },
      ],
      advisorConsulted: false,
      proposedAction: null,
      tokensUsed: 11,
    });

    render(<HomeChat />);
    fireEvent.click(screen.getByTestId('home-chat-chip-tenants-recent'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    const body = JSON.parse(call[1]?.body ?? '{}') as Record<string, unknown>;
    expect(body.forcePersonaId).toBe('T2_admin_strategist');
    expect(String(body.userText)).toContain('tenants 10 wapya');
  });

  it('renders the assistant bubble + tool list after a successful turn', async () => {
    mockGatewayOnce({
      threadId: 'thr_render',
      finalPersonaId: 'T2_admin_strategist',
      responseText: 'Kill-switch iko ARM, hakuna mabadiliko leo.',
      handoffs: [],
      toolCalls: [
        {
          name: 'PolicyGate',
          status: 'ok',
          latencyMs: 13,
        },
      ],
      advisorConsulted: false,
      proposedAction: null,
      tokensUsed: 9,
    });

    render(<HomeChat />);
    fireEvent.click(screen.getByTestId('home-chat-chip-killswitch'));

    await waitFor(() => {
      expect(screen.queryByTestId('home-chat-bubble-assistant')).toBeTruthy();
    });
    const assistant = screen.getByTestId('home-chat-bubble-assistant');
    expect(assistant.textContent).toContain('Kill-switch iko ARM');
    expect(screen.getByTestId('home-chat-bubble-tools').textContent).toContain(
      'PolicyGate',
    );
  });
});

describe('PersonaGreeting · suggestion contract', () => {
  it('exposes the four high-leverage Swahili admin prompts', () => {
    render(<PersonaGreeting onSuggest={vi.fn()} />);
    const labels = ADMIN_SUGGESTIONS.map((c) => c.label);
    expect(labels).toContain('Onyesha tenants 10 wapya');
    expect(labels).toContain('Kill-switch hali');
    expect(labels).toContain('Sentry pilot errors leo');
    expect(labels).toContain('Audit chain integrity');
  });

  it('disables every chip when the gateway is unconfigured', () => {
    render(<PersonaGreeting onSuggest={vi.fn()} disabled />);
    for (const chip of ADMIN_SUGGESTIONS) {
      const btn = screen.getByTestId(
        `home-chat-chip-${chip.id}`,
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
  });
});
