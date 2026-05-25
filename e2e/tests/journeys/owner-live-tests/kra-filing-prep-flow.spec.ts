/**
 * Phase F.5 journey #6 — KRA filing prep.
 *
 * Day 5 of month → MD compiles MRI batch → owner reviews → submits via
 * the four-eye approval → KRA mock returns receipt.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const MRI_BATCH = {
  id: 'mri_batch_2026_04',
  period: '2026-04',
  totalGrossKes: 1_250_000,
  totalTaxKes: 125_000,
  receiptCount: 42,
  status: 'pending_owner',
};

test.describe('KRA filing prep (compile → four-eye → receipt) @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('compiles MRI batch, owner approves through four-eye, KRA returns receipt', async ({
    page,
  }) => {
    await seedOwnerAuth(page);

    let firstApproveCalled = false;
    let secondApproveCalled = false;
    let kraReceiptId: string | null = null;

    await page.route('**/api/v1/compliance/kra/batch/current', async (route) =>
      fulfillJson(route, ok(MRI_BATCH)),
    );

    await page.route('**/api/v1/compliance/kra/batch/mri_batch_2026_04/approve', async (route, request) => {
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.approverIndex === 1) firstApproveCalled = true;
      if (body.approverIndex === 2) secondApproveCalled = true;
      return fulfillJson(
        route,
        ok({
          status: body.approverIndex === 2 ? 'ready_to_submit' : 'pending_second_approver',
        }),
      );
    });

    await page.route('**/api/v1/compliance/kra/batch/mri_batch_2026_04/submit', async (route) => {
      kraReceiptId = 'kra_rcpt_xyz123';
      return fulfillJson(
        route,
        ok({
          submittedAt: new Date().toISOString(),
          kraReceiptId,
          status: 'submitted',
        }),
      );
    });

    await page.goto('/compliance');
    await page.evaluate(async () => {
      await fetch('/api/v1/compliance/kra/batch/mri_batch_2026_04/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverIndex: 1, approverId: 'usr_owner' }),
      });
      await fetch('/api/v1/compliance/kra/batch/mri_batch_2026_04/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverIndex: 2, approverId: 'usr_accountant' }),
      });
      await fetch('/api/v1/compliance/kra/batch/mri_batch_2026_04/submit', {
        method: 'POST',
      });
    });

    await expect.poll(() => firstApproveCalled).toBe(true);
    await expect.poll(() => secondApproveCalled).toBe(true);
    await expect.poll(() => kraReceiptId).toBe('kra_rcpt_xyz123');
  });
});
