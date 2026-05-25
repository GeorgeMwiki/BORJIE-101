/**
 * Wave-2 deep-scrub journey: owner-portal damage-deduction approvals.
 *
 * The DamageDeductionApproval feature component fetches
 *   GET  /api/v1/owner/damage-deductions?status=pending_owner
 * and the row buttons fire
 *   POST /api/v1/owner/damage-deductions/:id/approve
 *   POST /api/v1/owner/damage-deductions/:id/reject
 *
 * The component is shipped in this branch but the page route mounting it is
 * not yet wired. The specs below assume a `/damage-deductions` route once
 * the page is added; under the current branch they are `.fixme`'d and
 * documented so that wiring the page lights them up automatically.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  captureRequest,
  fulfillJson,
  ok,
  seedOwnerAuth,
  screenshotCheckpoint,
} from './_helpers';

const OWNER_BASE_URL = process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000';

const PENDING = [
  {
    id: 'dd_1',
    leaseId: 'lease_1',
    tenantName: 'Asha Mwangi',
    unitLabel: 'Block A — Unit 12',
    items: [
      { code: 'WALL', description: 'Repaint living room', amount: 12_000 },
      { code: 'KEY', description: 'Lost key replacement', amount: 1_500 },
    ],
    totalAmount: 13_500,
    depositOnHand: 30_000,
    status: 'pending_owner',
    evidenceUrls: ['https://cdn.example.test/photo1.jpg'],
  },
  {
    id: 'dd_2',
    leaseId: 'lease_2',
    tenantName: 'Brian Otieno',
    unitLabel: 'Block C — Unit 4',
    items: [{ code: 'STOVE', description: 'Stove damage', amount: 8_000 }],
    totalAmount: 8_000,
    depositOnHand: 25_000,
    status: 'pending_owner',
    evidenceUrls: [],
  },
] as const;

test.describe('owner-portal damage-deduction approvals @journeys', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real owner-portal dev server (USE_REAL_SERVERS=1).');

  // The owner-portal does not yet mount DamageDeductionApproval at a routed
  // Wired in commit C4 (wave-3): /damage-deductions route mounts
  // DamageDeductionsPage which renders the DamageDeductionApproval
  // feature component inside the existing PrivateRoute > Layout wrap.

  test.beforeEach(async ({ page }) => {
    await seedOwnerAuth(page);
  });

  test('renders pending list and approves a deduction', async ({ page }) => {
    let store = [...PENDING];
    const approve = captureRequest(ok({ id: 'dd_1', status: 'approved' }));

    await page.route('**/api/v1/owner/damage-deductions**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (/\/dd_1\/approve/.test(url) && method === 'POST') {
        store = store.filter((d) => d.id !== 'dd_1'); // immutable filter
        return approve.handler(route, request);
      }
      if (/\/dd_\d+\/(approve|reject)/.test(url) && method === 'POST') {
        return fulfillJson(route, ok({ status: 'updated' }));
      }
      return fulfillJson(route, ok(store));
    });

    await page.goto('/damage-deductions');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Block A — Unit 12')).toBeVisible();
    await expect(page.getByText('Block C — Unit 4')).toBeVisible();
    await expect(page.getByText('13,500')).toBeVisible();

    await screenshotCheckpoint(page, 'owner-damage-deductions-list');

    await page
      .getByRole('button', { name: /approve.*Block A — Unit 12/i })
      .click();

    await expect.poll(() => approve.getRequest()?.method() ?? null).toBe('POST');
    await expect(page.getByText('Block A — Unit 12')).toBeHidden();
    await expect(page.getByText('Block C — Unit 4')).toBeVisible();
  });

  test('rejects a deduction and surfaces server errors', async ({ page }) => {
    let store = [...PENDING];
    let firstReject = true;

    await page.route('**/api/v1/owner/damage-deductions**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (/\/dd_2\/reject/.test(url) && method === 'POST') {
        if (firstReject) {
          firstReject = false;
          return fulfillJson(
            route,
            { success: false, error: { code: 'E_PERM', message: 'Owner cannot reject post-deadline' } },
            403,
          );
        }
        store = store.filter((d) => d.id !== 'dd_2');
        return fulfillJson(route, ok({ id: 'dd_2', status: 'rejected' }));
      }
      return fulfillJson(route, ok(store));
    });

    await page.goto('/damage-deductions');
    await page.getByRole('button', { name: /reject.*Block C — Unit 4/i }).click();
    await expect(page.getByText(/cannot reject post-deadline/i)).toBeVisible();
  });

  test('shows the empty state when there are no pending deductions', async ({ page }) => {
    await page.route('**/api/v1/owner/damage-deductions**', async (route) => {
      await fulfillJson(route, ok([]));
    });
    await page.goto('/damage-deductions');
    // The component renders an EmptyState — assert by the translation keys'
    // English defaults that ship in messages/en.json (damageDeductionApproval.emptyTitle).
    await expect(page.getByText(/no pending|nothing to review/i).first()).toBeVisible();
  });
});
