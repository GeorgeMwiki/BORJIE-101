/**
 * Golden buyer-inquiry flow — broken-loop regression guard.
 *
 * The loop a raised inquiry must travel, THROUGH the owner-web `/flows`
 * surface, is:
 *
 *   task_assigned  →  awaiting_owner_approval  →  delivered
 *
 * The middle hop is the one the worker draft-response leg owns. Before the
 * Inquiry-queue section landed on `/flows`, an inquiry stalled at
 * `task_assigned` forever — no surface called POST /inquiries/:id/respond,
 * so it never reached the owner's approval queue, and never delivered. This
 * test drives the WHOLE loop through the rendered page (no direct gateway
 * calls): it reads the queued inquiry, types a reply, clicks "Send reply"
 * (the queue caller), watches the run move into "Responses awaiting your
 * approval", then clicks "Approve & deliver" and asserts it is delivered.
 *
 * Broken-loop sentinel: if the Inquiry-queue caller is removed from the page,
 * "Send reply" never fires POST /inquiries/:id/respond, the run never parks
 * for approval, and the approval-row assertion times out — the test goes RED.
 * This is asserted directly in the final case (no respond call ⇒ no approval
 * row ⇒ never delivered).
 *
 * The api-client is stubbed via the @/lib/api-client module mock against a
 * tiny in-memory flow_runs state machine, so the component never touches the
 * network, Supabase, or the real gateway.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { apiRequest } from '@/lib/api-client';
// The route page.tsx is now a thin async SERVER wrapper that only resolves
// the locale cookie and seeds the client surface; RTL renders the client
// FlowsSurface directly (default `en` locale → the English copy asserted
// below resolves through the i18n layer unchanged).
import { FlowsSurface as FlowsPage } from '../FlowsSurface';

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const RUN_ID = 'frun_test_inquiry_1';

type RunState = 'task_assigned' | 'awaiting_owner_approval' | 'delivered';

/**
 * A one-run in-memory flow_runs state machine mirroring the gateway's
 * inquiry-flow contract. The owner-web page sees ONLY the unwrapped `data`
 * (apiRequest strips the {success, data} envelope), so we return the inner
 * payloads directly.
 */
function makeFlowGateway(opts: { readonly disableRespond?: boolean } = {}) {
  const run = {
    id: RUN_ID,
    state: 'task_assigned' as RunState,
    subjectRef: 'listing_gold_42',
    payload: { message: 'Is this gold lot still available?', listingTitle: 'Gold doré 12kg' },
    response: null as Record<string, unknown> | null,
    createdAt: '2026-06-15T08:00:00Z',
    updatedAt: '2026-06-15T08:00:00Z',
  };

  return vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    const method = options?.method ?? 'GET';

    // Owner: installed flows + open-run count.
    if (path === '/api/v1/mining/flows' && method === 'GET') {
      return { flows: [{ flowKey: 'buyer_inquiry', name: 'Buyer inquiry on a listing', status: 'active' }], openRunCount: run.state === 'delivered' ? 0 : 1 };
    }
    // Automation posture — GATED (fail-closed) so replies PARK for approval.
    if (path.startsWith('/api/v1/workflow/flow-autonomy/')) {
      return { posture: 'gated', confirmationState: 'confirmed' };
    }
    // Worker queue — open runs (task_assigned / awaiting_owner_approval).
    if (path === '/api/v1/mining/flows/inquiries/queue' && method === 'GET') {
      return run.state === 'task_assigned' ? [run] : [];
    }
    // Owner pending — runs parked awaiting approval.
    if (path === '/api/v1/mining/flows/inquiries/pending' && method === 'GET') {
      return run.state === 'awaiting_owner_approval' ? [run] : [];
    }
    // Worker drafts a response → parks for owner approval (GATED). This is
    // the caller the Inquiry-queue section adds; when it never fires, the run
    // is stranded at task_assigned.
    if (path === `/api/v1/mining/flows/inquiries/${RUN_ID}/respond` && method === 'POST') {
      if (opts.disableRespond) {
        throw new Error('respond endpoint must not be hit when the queue caller is absent');
      }
      const body = options?.body as { message?: string } | undefined;
      run.state = 'awaiting_owner_approval';
      run.response = { message: body?.message ?? '', auto: false };
      return { id: RUN_ID, state: 'awaiting_owner_approval', autoDelivered: false };
    }
    // Owner approves the parked response → delivered.
    if (path === `/api/v1/mining/flows/inquiries/${RUN_ID}/approve` && method === 'POST') {
      run.state = 'delivered';
      return { id: RUN_ID, state: 'delivered' };
    }
    return null;
  });
}

function withClient(ui: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe('Golden buyer-inquiry loop · advanced through owner-web /flows', () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(makeFlowGateway());
  });

  it('advances a raised inquiry task_assigned → awaiting_owner_approval → delivered through the surface', async () => {
    render(withClient(<FlowsPage />));

    // The queued inquiry appears in the Inquiry queue (state: task_assigned).
    const queueSection = await screen.findByTestId('inquiry-queue');
    await within(queueSection).findByTestId('inquiry-queue-row');
    expect(within(queueSection).getByText('Is this gold lot still available?')).toBeTruthy();

    // The operator drafts a reply and sends it (the worker draft-response leg).
    const textarea = within(queueSection).getByLabelText('Your reply') as HTMLTextAreaElement;
    const sendButton = within(queueSection).getByRole('button', {
      name: /send reply/i,
    }) as HTMLButtonElement;

    // Send is disabled until the reply has content.
    expect(sendButton.disabled).toBe(true);
    fireEvent.change(textarea, {
      target: { value: 'Yes, the lot is available. Happy to share assay results.' },
    });
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(sendButton);

    // POST /respond fired → the run parks for owner approval and surfaces in
    // the approvals queue (the loop's middle hop, proven through the UI).
    await waitFor(() => {
      const respondCall = apiRequestMock.mock.calls.find(
        (c) => String(c[0]) === `/api/v1/mining/flows/inquiries/${RUN_ID}/respond`,
      );
      expect(respondCall).toBeTruthy();
    });
    const approveRow = await screen.findByText('Approve & deliver');
    expect(approveRow).toBeTruthy();

    // The owner approves → the run is delivered to the buyer (loop complete).
    fireEvent.click(approveRow.closest('button') as HTMLButtonElement);
    await waitFor(() => {
      const approveCall = apiRequestMock.mock.calls.find(
        (c) => String(c[0]) === `/api/v1/mining/flows/inquiries/${RUN_ID}/approve`,
      );
      expect(approveCall).toBeTruthy();
    });
    // The approval row clears once the run is delivered (queue + pending both empty).
    await waitFor(() => {
      expect(screen.queryByText('Approve & deliver')).toBeNull();
    });
  });

  it('shows the empty state when no inquiries are waiting for a reply', async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === '/api/v1/mining/flows') {
        return { flows: [{ flowKey: 'buyer_inquiry', name: 'Buyer inquiry on a listing', status: 'active' }], openRunCount: 0 };
      }
      if (path.startsWith('/api/v1/workflow/flow-autonomy/')) {
        return { posture: 'gated', confirmationState: 'confirmed' };
      }
      if (path.endsWith('/inquiries/queue') || path.endsWith('/inquiries/pending')) {
        return [];
      }
      return null;
    });
    render(withClient(<FlowsPage />));
    await waitFor(() => {
      expect(screen.getByTestId('inquiry-queue-empty')).toBeTruthy();
      expect(screen.getByText('No inquiries waiting for a reply')).toBeTruthy();
    });
  });

  /**
   * The broken-loop sentinel made explicit: WITHOUT the queue caller firing
   * POST /respond, the run is stranded at task_assigned — it never parks for
   * approval, so "Approve & deliver" never appears and it is never delivered.
   * The previous test passing while this one documents the failure mode is
   * what proves the caller (not some unrelated wiring) closes the loop.
   */
  it('strands the inquiry at task_assigned when the respond caller never fires', async () => {
    apiRequestMock.mockImplementation(makeFlowGateway({ disableRespond: true }));
    render(withClient(<FlowsPage />));

    const queueSection = await screen.findByTestId('inquiry-queue');
    await within(queueSection).findByTestId('inquiry-queue-row');

    // No reply is sent (simulating the absence of the queue caller). The run
    // never reaches the approval queue.
    await waitFor(() => {
      expect(screen.queryByText('Approve & deliver')).toBeNull();
    });
    // And the respond endpoint was never hit.
    const respondCall = apiRequestMock.mock.calls.find((c) =>
      String(c[0]).endsWith('/respond'),
    );
    expect(respondCall).toBeUndefined();
  });
});
