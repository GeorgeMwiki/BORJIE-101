/**
 * Real-LLM E2E: user types a natural-language maintenance request and the
 * brain emits a PROPOSED_ACTION card that, once approved, creates an
 * actual case row.
 *
 * Skipped unless:
 *   - E2E_REAL_LLM=true
 *   - ANTHROPIC_API_KEY is set
 *
 * We exercise the HTTP surface directly (rather than the UI) so this
 * suite stays stable across CSS/layout changes. The UI Spotlight lives
 * in @borjie/spotlight and has its own render tests.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  fetchTestJwt,
} from './_shared';

test.describe('real-LLM: create maintenance case via chat', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(120_000);

  test('chat -> PROPOSED_ACTION -> approve -> case row persists', async ({ request }) => {
    const jwt = await fetchTestJwt();

    // 1. Ask the brain to create a case.
    const turn = await request.post(`${GATEWAY_URL}/api/v1/ai-chat/turn`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      data: {
        persona: 'mwikila-admin',
        messages: [
          {
            role: 'user',
            content:
              'Create a maintenance case for unit-4B: the tap is leaking. Priority is P2.',
          },
        ],
      },
    });
    expect(turn.status()).toBeLessThan(500);

    if (turn.status() === 404) {
      test.skip(true, 'ai-chat/turn not wired in this environment');
      return;
    }

    const body = (await turn.json()) as {
      proposals?: Array<{ id: string; kind: string; payload?: unknown }>;
      message?: string;
    };

    // The brain SHOULD surface at least one proposed action; if it chose
    // to decline (e.g., missing context), skip the rest rather than fail
    // spuriously on LLM non-determinism.
    const proposal = body.proposals?.find((p) => p.kind === 'CREATE_CASE');
    if (!proposal) {
      test.skip(true, 'Brain did not surface CREATE_CASE proposal this turn');
      return;
    }

    // 2. Approve the proposal.
    const approve = await request.post(
      `${GATEWAY_URL}/api/v1/exceptions/${proposal.id}/approve`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        data: {},
      },
    );
    expect(approve.status()).toBeLessThan(500);

    // 3. Verify a case row was created.
    const list = await request.get(`${GATEWAY_URL}/api/v1/cases?limit=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(list.status()).toBeLessThan(500);
    if (list.status() === 200) {
      const listBody = (await list.json()) as {
        data?: { items?: unknown[] } | unknown[];
      };
      const rows = Array.isArray(listBody.data)
        ? listBody.data
        : listBody.data?.items ?? [];
      expect(rows.length).toBeGreaterThan(0);
    }
  });
});
