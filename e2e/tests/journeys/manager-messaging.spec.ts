/**
 * Wave-2 deep-scrub journey: estate-manager messaging.
 *
 * Flow under test:
 *   1. Manager opens /messaging — list shows live conversations from the
 *      gateway (mocked).
 *   2. Manager clicks a conversation; messages render; an automatic
 *      "mark as read" call fires.
 *   3. Manager types a reply and sends it; the POST hits the messages
 *      endpoint and the new message appears in the transcript.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  captureRequest,
  fulfillJson,
  ok,
  seedManagerAuth,
  screenshotCheckpoint,
} from './_helpers';

const MANAGER_BASE_URL = process.env.ESTATE_MANAGER_URL ?? 'http://localhost:3003';

const CONVERSATION = {
  id: 'conv_1',
  subject: 'Plumbing on Block C',
  unreadCount: 2,
  updatedAt: new Date().toISOString(),
  participants: [
    { id: 'p1', name: 'Jane Tenant', type: 'tenant' },
    { id: 'p2', name: 'Mary Manager', type: 'manager' },
  ],
  lastMessage: {
    id: 'msg_2',
    senderId: 'p1',
    senderType: 'tenant',
    content: 'Water still leaking',
    createdAt: new Date().toISOString(),
  },
};

const INITIAL_MESSAGES = [
  {
    id: 'msg_1',
    senderId: 'p2',
    senderType: 'manager',
    content: 'Plumber dispatched',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'msg_2',
    senderId: 'p1',
    senderType: 'tenant',
    content: 'Water still leaking',
    createdAt: new Date().toISOString(),
  },
];

test.describe('estate-manager messaging @journeys', () => {
  test.use({ baseURL: MANAGER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real estate-manager-app dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedManagerAuth(page);
  });

  test('list -> open -> mark-as-read -> send reply', async ({ page }) => {
    let messageList = [...INITIAL_MESSAGES];

    await page.route('**/api/v1/messaging/conversations**', async (route) => {
      const url = route.request().url();
      if (/\/conversations\/conv_1\/messages/.test(url)) {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON() as { content: string };
          const newMsg = {
            id: `msg_${messageList.length + 1}`,
            senderId: 'p2',
            senderType: 'manager',
            content: body.content,
            createdAt: new Date().toISOString(),
          };
          messageList = [...messageList, newMsg]; // immutable append
          return fulfillJson(route, ok(newMsg), 201);
        }
        return fulfillJson(route, ok(messageList));
      }
      if (/\/conversations\/conv_1\/read/.test(url)) {
        return fulfillJson(route, ok({ marked: true }));
      }
      if (/\/conversations\/conv_1$/.test(url) || /\/conversations\/conv_1\?/.test(url)) {
        return fulfillJson(route, ok(CONVERSATION));
      }
      // List endpoint
      return fulfillJson(route, ok([CONVERSATION]));
    });

    const readCapture = captureRequest(ok({ marked: true }));
    await page.route('**/api/v1/messaging/conversations/conv_1/read', readCapture.handler);

    await page.goto('/messaging');
    await page.waitForLoadState('domcontentloaded');

    // Conversation card shows.
    await expect(page.getByText('Plumbing on Block C')).toBeVisible();
    await expect(page.getByText('Water still leaking').first()).toBeVisible();

    await page.getByText('Plumbing on Block C').click();
    await expect(page).toHaveURL(/\/messaging\/conv_1/);

    // Both initial messages appear.
    await expect(page.getByText('Plumber dispatched')).toBeVisible();
    await expect(page.getByText('Water still leaking')).toBeVisible();

    // Mark-as-read fires automatically because unreadCount > 0.
    await expect.poll(() => readCapture.getRequest()?.method() ?? null).toBe('POST');

    await screenshotCheckpoint(page, 'manager-conversation-loaded');

    // Send a reply.
    const composeInput = page.getByPlaceholder(/type your message|message|type a message/i).first();
    await composeInput.fill('Plumber arriving in 20 minutes');
    await page.getByRole('button', { name: /send|sending/i }).first().click();

    await expect(page.getByText('Plumber arriving in 20 minutes')).toBeVisible();
  });

  test('send button disables until the user types content', async ({ page }) => {
    await page.route('**/api/v1/messaging/conversations**', async (route) => {
      const url = route.request().url();
      if (/\/conversations\/conv_1\/messages/.test(url)) {
        return fulfillJson(route, ok(INITIAL_MESSAGES));
      }
      if (/\/conversations\/conv_1$/.test(url) || /\/conversations\/conv_1\?/.test(url)) {
        return fulfillJson(route, ok({ ...CONVERSATION, unreadCount: 0 }));
      }
      return fulfillJson(route, ok([CONVERSATION]));
    });

    await page.goto('/messaging/conv_1');
    await page.waitForLoadState('domcontentloaded');
    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    await expect(sendBtn).toBeDisabled();
    await page.getByPlaceholder(/type your message|message|type a message/i).first().fill('Hi');
    await expect(sendBtn).toBeEnabled();
  });

  test('list shows a typed empty state when there are no conversations', async ({ page }) => {
    await page.route('**/api/v1/messaging/conversations**', async (route) => {
      await fulfillJson(route, ok([]));
    });
    await page.goto('/messaging');
    await expect(page.getByText(/no conversations|start a new/i).first()).toBeVisible();
  });

  test('search filters the conversation list locally', async ({ page }) => {
    await page.route('**/api/v1/messaging/conversations**', async (route) => {
      const second = {
        ...CONVERSATION,
        id: 'conv_2',
        subject: 'Lease renewal Block A',
        lastMessage: { ...CONVERSATION.lastMessage!, content: 'When can we sign?' },
      };
      await fulfillJson(route, ok([CONVERSATION, second]));
    });

    await page.goto('/messaging');
    await expect(page.getByText('Plumbing on Block C')).toBeVisible();
    await expect(page.getByText('Lease renewal Block A')).toBeVisible();

    await page.getByPlaceholder(/search/i).fill('plumb');
    await expect(page.getByText('Plumbing on Block C')).toBeVisible();
    await expect(page.getByText('Lease renewal Block A')).toBeHidden();
  });
});
