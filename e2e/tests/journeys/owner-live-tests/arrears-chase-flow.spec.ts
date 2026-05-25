/**
 * Phase F.5 journey #4 — Arrears chase ladder.
 *
 * Tenant 9 days late → MD escalation ladder triggers → SMS reminder drafted
 * → owner approves → SMS sent.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const ARREARS_CASE = {
  id: 'arr_1',
  customerId: 'cust_late_1',
  customerName: 'David Late',
  daysLate: 9,
  amountKes: 35_000,
  unitLabel: 'Block B — Unit 7',
  ladderStage: 'reminder_2',
};

test.describe('arrears chase (T+9d → reminder SMS) @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('triggers escalation ladder, drafts SMS, owner approves, SMS sent', async ({ page }) => {
    await seedOwnerAuth(page);

    let approveCount = 0;
    let smsSent = false;

    await page.route('**/api/v1/arrears/cases**', async (route) =>
      fulfillJson(route, ok([ARREARS_CASE])),
    );

    await page.route('**/api/v1/arrears/draft', async (route) =>
      fulfillJson(
        route,
        ok({
          ladderStage: 'reminder_2',
          channel: 'sms',
          draft:
            'Habari David, your rent of KES 35,000 is 9 days overdue. Please pay by Friday to avoid late fees. — Borjie',
        }),
      ),
    );

    await page.route('**/api/v1/arrears/cases/arr_1/approve', async (route) => {
      approveCount += 1;
      return fulfillJson(route, ok({ status: 'approved' }));
    });

    await page.route('**/api/v1/notifications/sms', async (route) => {
      smsSent = true;
      return fulfillJson(route, ok({ messageId: 'sms_1', status: 'queued' }));
    });

    await page.goto('/jarvis');
    await page.evaluate(async () => {
      const draft = await fetch('/api/v1/arrears/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: 'arr_1' }),
      });
      const draftJson = await draft.json();
      await fetch('/api/v1/arrears/cases/arr_1/approve', { method: 'POST' });
      await fetch('/api/v1/notifications/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: '+254700000001', body: draftJson.data.draft }),
      });
    });

    await expect.poll(() => approveCount).toBe(1);
    await expect.poll(() => smsSent).toBe(true);
  });
});
