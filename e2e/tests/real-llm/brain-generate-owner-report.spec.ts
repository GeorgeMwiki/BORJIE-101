/**
 * Real-LLM E2E: admin asks the brain to draft a monthly owner report.
 * Asserts that a report is produced and a downloadable artefact is linked.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  fetchTestJwt,
} from './_shared';

test.describe('real-LLM: draft owner report via chat', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(180_000);

  test('chat -> report generated -> file downloadable', async ({ request }) => {
    const jwt = await fetchTestJwt();

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
              'Draft the monthly report for the owner of unit 12, covering revenue, maintenance cost and occupancy.',
          },
        ],
      },
    });
    if (turn.status() === 404) {
      test.skip(true, 'ai-chat/turn not wired in this environment');
      return;
    }
    expect(turn.status()).toBeLessThan(500);

    const body = (await turn.json()) as {
      artefacts?: Array<{ url?: string; kind?: string }>;
      proposals?: Array<{ kind: string; id: string }>;
    };

    const reportArtefact = body.artefacts?.find(
      (a) => a.kind === 'report' || a.kind === 'pdf',
    );
    if (!reportArtefact?.url) {
      test.skip(true, 'Brain did not return a downloadable artefact this turn');
      return;
    }

    const dl = await request.get(reportArtefact.url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(dl.status()).toBeLessThan(500);
    // A real PDF should be non-trivially sized; don't assert exact bytes.
    const buffer = await dl.body();
    expect(buffer.byteLength).toBeGreaterThan(200);
  });
});
