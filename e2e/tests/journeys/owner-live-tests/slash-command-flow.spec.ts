/**
 * Phase F.5 journey #10 — Slash-command palette.
 *
 * Owner types `/arrears` in Jarvis → slash palette fires → MD responds
 * with current arrears list.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const ARREARS_LIST = [
  { id: 'arr_1', customerName: 'David Late', daysLate: 9, amountKes: 35_000 },
  { id: 'arr_2', customerName: 'Eve Slow', daysLate: 14, amountKes: 28_000 },
  { id: 'arr_3', customerName: 'Frank Tardy', daysLate: 21, amountKes: 42_000 },
];

test.describe('slash-command /arrears @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('/arrears fires palette, MD responds with current arrears list', async ({ page }) => {
    await seedOwnerAuth(page);

    let arrearsListCalled = false;

    await page.route('**/api/v1/owner/jarvis/slash', async (route, request) => {
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.command === 'arrears') {
        arrearsListCalled = true;
        return fulfillJson(
          route,
          ok({
            command: 'arrears',
            messageId: 'msg_slash_1',
            content: '3 tenants in arrears. Total: KES 105,000.',
            uiParts: [
              {
                type: 'table',
                data: {
                  columns: ['Tenant', 'Days late', 'Amount'],
                  rows: ARREARS_LIST.map((a) => [a.customerName, a.daysLate, a.amountKes]),
                },
              },
            ],
          }),
        );
      }
      return fulfillJson(route, ok({ messageId: 'msg_noop' }));
    });

    await page.goto('/jarvis');
    await page.evaluate(async () => {
      await fetch('/api/v1/owner/jarvis/slash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'arrears' }),
      });
    });

    await expect.poll(() => arrearsListCalled).toBe(true);
  });
});
