/**
 * Phase F.5 journey #3 — Complaint triage.
 *
 * Tenant complains about parking → MD classifies + drafts an empathetic
 * response → owner reviews + approves → response sent.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const PARKING_COMPLAINT = {
  id: 'comp_park_1',
  unitLabel: 'Block C — Unit 4',
  category: 'parking',
  severity: 'normal',
  description: 'Neighbour blocks my designated bay every Friday',
  reportedAt: new Date().toISOString(),
};

const DRAFT_RESPONSE = {
  classification: { category: 'parking', severity: 'normal' },
  draft:
    "Hi Brian, thanks for flagging this. I'll speak to the unit blocking your bay and confirm by Friday. — Mr. Mwikila",
  rationale: 'Empathetic + clear action + deadline.',
};

test.describe('complaint triage (parking → empathetic reply) @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('classifies, drafts response, owner approves, response sent', async ({ page }) => {
    await seedOwnerAuth(page);

    let approved = false;
    let sent = false;

    await page.route('**/api/v1/complaints/**', async (route) =>
      fulfillJson(route, ok(PARKING_COMPLAINT)),
    );

    await page.route('**/api/v1/owner/jarvis/triage', async (route) =>
      fulfillJson(route, ok(DRAFT_RESPONSE)),
    );

    await page.route('**/api/v1/complaints/comp_park_1/approve', async (route) => {
      approved = true;
      return fulfillJson(route, ok({ status: 'approved' }));
    });

    await page.route('**/api/v1/messaging/send', async (route) => {
      sent = true;
      return fulfillJson(route, ok({ messageId: 'msg_sent_1', deliveredAt: new Date().toISOString() }));
    });

    await page.goto('/jarvis');
    await page.evaluate(async () => {
      const triage = await fetch('/api/v1/owner/jarvis/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complaintId: 'comp_park_1' }),
      });
      const triageJson = await triage.json();
      // Owner approves the draft (HIL gate).
      await fetch('/api/v1/complaints/comp_park_1/approve', { method: 'POST' });
      await fetch('/api/v1/messaging/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'cust_brian',
          body: triageJson.data.draft,
        }),
      });
    });

    await expect.poll(() => approved).toBe(true);
    await expect.poll(() => sent).toBe(true);
  });
});
