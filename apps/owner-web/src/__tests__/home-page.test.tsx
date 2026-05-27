/**
 * Owner-web home (/) — chat-first surface render tests.
 *
 * Covers:
 *   1. Renders the persona greeting card with the bilingual Swahili
 *      headline when the surface mounts with no thread.
 *   2. Renders all three suggestion chips ("portfolio overview", "cash
 *      runway", "decisions") with the Swahili copy.
 *   3. Clicking a suggestion chip routes through the existing brain
 *      send pipeline — the wire POST is observed by the stubbed fetch.
 *   4. After a brain response with tool calls arrives, the side panel
 *      ("home-toolcall-sidebar") renders one card per junior call.
 *
 * Mirrors the mock conventions used by `ask-page.test.tsx`: next/
 * navigation hooks are stubbed at the module level, the brain wire is
 * stubbed at the fetch layer, and rendering happens inside a fresh
 * QueryClientProvider so react-query state cannot leak between cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { HomeChat } from '@/components/home-chat/HomeChat';
import { PersonaGreeting } from '@/components/home-chat/PersonaGreeting';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (_key: string): string | null => null,
  }),
}));

function withClient(ui: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const baseProps = {
  salutation: 'Mzee Mwanaidi',
  tradingName: 'Mawe Bora',
  languagePreference: 'sw' as const,
};

beforeEach(() => {
  replaceMock.mockClear();
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
});

describe('HomeChat · persona greeting renders on fresh mount', () => {
  it('shows the bilingual Swahili headline with the salutation and trading name', () => {
    render(withClient(<HomeChat {...baseProps} />));
    const headline = screen.getByTestId('home-greeting-headline');
    expect(headline).toBeTruthy();
    expect(headline.textContent ?? '').toContain('Karibu');
    expect(headline.textContent ?? '').toContain('Mzee Mwanaidi');
    const greeting = screen.getByTestId('home-persona-greeting');
    expect(greeting.getAttribute('data-lang')).toBe('sw');
    expect(greeting.textContent ?? '').toContain('Mawe Bora');
  });
});

describe('HomeChat · suggestion chips render in Swahili', () => {
  it('renders three chips with the three documented Swahili prompts', () => {
    render(withClient(<HomeChat {...baseProps} />));
    const chips = screen.getAllByTestId('home-suggestion-chip');
    expect(chips).toHaveLength(3);
    const labels = chips.map((c) => c.textContent ?? '').join('|');
    expect(labels).toContain('Onyesha muhtasari wa portfolio');
    expect(labels).toContain('Hali ya hela na siku zilizobaki');
    expect(labels).toContain('Maamuzi yanayosubiri');
  });
});

describe('PersonaGreeting · suggestion chip fires onSuggestion with the chip label', () => {
  it('forwards the Swahili label exactly as shown when the chip is clicked', () => {
    const handler = vi.fn();
    render(
      <PersonaGreeting
        salutation="Mzee Mwanaidi"
        tradingName="Mawe Bora"
        languagePreference="sw"
        onSuggestion={handler}
      />,
    );
    const chips = screen.getAllByTestId('home-suggestion-chip');
    fireEvent.click(chips[0]!);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBe('Onyesha muhtasari wa portfolio');
  });
});

describe('HomeChat · brain tool calls render in the side panel', () => {
  it('renders one toolcall card per junior call after the brain replies', async () => {
    // The POST /turn envelope carries the tool calls we want to render
    // in the sidebar. After the mutation commits, useBrainThread fires
    // a follow-up GET /threads/:id to hydrate the persisted log — and
    // the hook's hydration effect REPLACES the in-memory transcript
    // (which is where the streamed toolCalls live) with whatever the
    // GET returns. To keep the freshly-streamed toolCalls visible long
    // enough to assert on, we make the GET fail; the hook treats the
    // failure as a non-fatal "could not reload from server" and keeps
    // the post-mutation transcript intact (only `error` is surfaced).
    const turnEnvelope = {
      threadId: 'thr_home_01',
      finalPersonaId: 'owner_strategist',
      responseText: 'Portfolio summary attached.',
      handoffs: [],
      toolCalls: [
        { name: 'GeologyJunior', status: 'ok', latencyMs: 240 },
        { name: 'TreasuryJunior', status: 'ok', latencyMs: 188 },
      ],
      advisorConsulted: false,
      proposedAction: null,
      tokensUsed: 42,
      citations: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const isThreadGet = /\/api\/v1\/brain\/threads\//.test(url);
      if (isThreadGet) {
        return new Response('not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return new Response(JSON.stringify(turnEnvelope), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(withClient(<HomeChat {...baseProps} />));

    // The sidebar initially shows the empty-state copy.
    expect(screen.getByTestId('home-toolcall-empty')).toBeTruthy();

    // Click the first suggestion chip — same effect as typing into the
    // composer + pressing enter. The chip fires `void send(...)` so the
    // promise must be drained via waitFor.
    const firstChip = screen.getAllByTestId('home-suggestion-chip')[0]!;
    await act(async () => {
      fireEvent.click(firstChip);
    });

    // Quick sanity check — user bubble appears synchronously inside the
    // send() pipeline. If this is missing the chip click never reached
    // the brain wire.
    await waitFor(() => {
      const userBubble = screen.queryByTestId('ask-bubble-user');
      expect(userBubble).not.toBeNull();
    });

    // After the brain replies, the sidebar should expose one card per
    // tool call. We wait for them because the brain mutation resolves
    // asynchronously inside the streamBrainChat iterable. waitFor is
    // long-running because the mutation flows through supabase auth +
    // fetch + JSON parse + state-batching before the tool-call sidebar
    // re-renders.
    await waitFor(
      () => {
        const cards = screen.queryAllByTestId('home-toolcall-card');
        expect(cards.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5_000 },
    );
    const cards = screen.getAllByTestId('home-toolcall-card');
    const labels = cards.map((c) => c.getAttribute('data-tool-name') ?? '');
    expect(labels).toContain('GeologyJunior');
    expect(labels).toContain('TreasuryJunior');

    // Confirm the brain wire was actually hit.
    expect(fetchMock).toHaveBeenCalled();
  });
});
