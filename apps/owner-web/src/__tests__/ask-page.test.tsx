/**
 * ask-Borjie surface — render tests.
 *
 * Covers:
 *   1. Renders the "Connect to Borjie backend" empty-state when
 *      NEXT_PUBLIC_API_GATEWAY_URL is missing (no crash, env var name
 *      surfaced literally).
 *   2. Renders the fresh-empty intro when configured + no thread.
 *   3. Renders citation chips when the brain mutation resolves with
 *      corpus evidence in the response.
 *
 * The page uses `next/navigation` hooks — stubbed with vi.mock.
 * The brain endpoint is stubbed at the fetch layer via vi.stubGlobal,
 * matching the pattern used by `brain-api.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AskBorjieSurface } from '@/components/ask/AskBorjieSurface';
import { AskBubble } from '@/components/ask/AskBubble';
import { useAskBorjie } from '@/lib/queries/brain';

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

beforeEach(() => {
  replaceMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
});

describe('AskBorjieSurface · empty / unconfigured state', () => {
  it('renders the unconfigured banner when NEXT_PUBLIC_API_GATEWAY_URL is missing', () => {
    // Intentionally NOT setting the env var.
    render(withClient(<AskBorjieSurface />));
    const banner = screen.getByTestId('brain-not-configured');
    expect(banner).toBeTruthy();
    expect(banner.textContent ?? '').toContain('NEXT_PUBLIC_API_GATEWAY_URL');
  });
});

describe('AskBorjieSurface · fresh transcript', () => {
  it('renders the fresh empty state when configured and no messages', () => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
    render(withClient(<AskBorjieSurface />));
    const fresh = screen.getByTestId('brain-fresh-intro');
    expect(fresh).toBeTruthy();
    expect(fresh.textContent ?? '').toMatch(/Ask Borjie Brain/i);
  });
});

describe('AskBorjieSurface · citations render in the assistant bubble', () => {
  it('renders one citation chip per BrainCitation returned by /turn', async () => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            threadId: 'thr_cite',
            finalPersonaId: 'borjie',
            responseText: 'Citing the corpus on PML 25434.',
            handoffs: [],
            toolCalls: [],
            advisorConsulted: false,
            proposedAction: null,
            tokensUsed: 11,
            citations: [
              {
                id: 'chunk_alpha',
                mineralCode: 'AU',
                section: '2.1 Renewal pack',
                score: 0.91,
                sourceFile: 'pml-25434.pdf',
              },
              {
                id: 'chunk_beta',
                mineralCode: 'AU',
                section: '3.4 Output',
                score: 0.74,
                sourceFile: 'shift-report.pdf',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // We render the underlying hook directly through a probe component
    // rather than driving the AskComposer form — this keeps the test
    // focused on the wire→UI contract for citations and avoids the
    // react-hook-form synthetic-event quirks in jsdom.
    let sendFn: ((text: string) => Promise<void>) | null = null;
    function Probe() {
      const result = useAskBorjie();
      sendFn = result.send;
      return (
        <div data-testid="probe-list">
          {result.messages.map((m) => (
            <AskBubble key={m.id} message={m} />
          ))}
        </div>
      );
    }

    render(withClient(<Probe />));

    await act(async () => {
      await sendFn?.('What is the PML renewal pack?');
    });

    const chips = await screen.findAllByTestId('brain-citation-chip');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    const labels = chips.map((c) => c.textContent ?? '').join('|');
    expect(labels).toContain('2.1 Renewal pack');
    expect(labels).toContain('3.4 Output');
  });
});
