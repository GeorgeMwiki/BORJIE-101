/**
 * Wave-2 deep-scrub journey: estate-manager notifications mark-as-read.
 *
 * Flow under test:
 *   1. Manager opens /notifications — list renders with mixed read/unread.
 *   2. Clicking a single unread notification fires
 *      POST /api/v1/notifications/:id/read.
 *   3. Clicking "Mark all read" fires POST /api/v1/notifications/read-all.
 *   4. The unread badge (subtitle text) reflects the new state.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  captureRequest,
  fulfillJson,
  ok,
  seedManagerAuth,
} from './_helpers';

const MANAGER_BASE_URL = process.env.ESTATE_MANAGER_URL ?? 'http://localhost:3003';

const NOW = new Date().toISOString();

function makeNotifications(): readonly {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  actionUrl: string | null;
}[] {
  return [
    {
      id: 'n1',
      title: 'Lease expires Friday',
      body: 'Block A unit 12',
      readAt: null,
      sentAt: NOW,
      deliveredAt: NOW,
      createdAt: NOW,
      actionUrl: null,
    },
    {
      id: 'n2',
      title: 'Inspection complete',
      body: 'Block C unit 4',
      readAt: NOW,
      sentAt: NOW,
      deliveredAt: NOW,
      createdAt: NOW,
      actionUrl: null,
    },
    {
      id: 'n3',
      title: 'Rent received',
      body: '120,000 KES',
      readAt: null,
      sentAt: NOW,
      deliveredAt: NOW,
      createdAt: NOW,
      actionUrl: null,
    },
  ];
}

test.describe('estate-manager notifications @journeys', () => {
  test.use({ baseURL: MANAGER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real estate-manager-app dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedManagerAuth(page);
  });

  test('clicking a single unread notification calls the per-id mark-read endpoint', async ({ page }) => {
    let store = makeNotifications();
    const single = captureRequest(ok({ id: 'n1', readAt: NOW }));

    await page.route('**/api/v1/notifications**', async (route, request) => {
      const url = request.url();
      if (/\/notifications\/n1\/read/.test(url) && request.method() === 'POST') {
        store = store.map((n) => (n.id === 'n1' ? { ...n, readAt: NOW } : n));
        return single.handler(route, request);
      }
      if (/\/notifications\/read-all/.test(url) && request.method() === 'POST') {
        return fulfillJson(route, ok({ count: store.filter((n) => !n.readAt).length }));
      }
      return fulfillJson(route, ok(store));
    });

    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Lease expires Friday')).toBeVisible();

    // 2 unread initially — confirm visual indicator (the unread dot is a span
    // with bg-primary-500). Use the count of unread rows by looking for the
    // text "2 unread" rendered by notificationsList.unreadCount.
    await expect(page.getByText(/2 unread/i)).toBeVisible();

    await page.getByText('Lease expires Friday').click();

    await expect.poll(() => single.getRequest()?.method() ?? null).toBe('POST');
    expect(single.getRequest()?.url()).toMatch(/\/notifications\/n1\/read/);
  });

  test('mark all as read fires read-all and clears the unread badge', async ({ page }) => {
    let store = makeNotifications();
    const readAll = captureRequest(ok({ count: 2 }));

    await page.route('**/api/v1/notifications**', async (route, request) => {
      const url = request.url();
      if (/\/notifications\/read-all/.test(url) && request.method() === 'POST') {
        store = store.map((n) => ({ ...n, readAt: NOW }));
        return readAll.handler(route, request);
      }
      return fulfillJson(route, ok(store));
    });

    await page.goto('/notifications');
    await expect(page.getByText(/2 unread/i)).toBeVisible();

    await page.getByRole('button', { name: /mark all read/i }).click();
    await expect.poll(() => readAll.getRequest()?.method() ?? null).toBe('POST');
    await expect(page.getByText(/0 unread/i)).toBeVisible();
  });
});
