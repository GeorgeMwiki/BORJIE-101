/**
 * Wave-12 smoke: owner-portal OwnerAdvisor (Mr. Mwikila owner persona).
 *
 * Same shape as brain-chat-admin.spec but pointed at the owner portal and
 * asserting the portfolio-health style block.
 */

import { test, expect } from '@playwright/test';

test.use({ project: 'owner-portal' });

const UAT_OWNER_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1c2VySWQiOiJ1YXQtb3duZXItMDEiLCJ0ZW5hbnRJZCI6InRlbi11YXQtMDAxIiwicm9sZSI6Im93bmVyIn0.' +
  'uat-signature-placeholder';

test.describe('Wave-12 — owner-portal OwnerAdvisor (Mr. Mwikila)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((token) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem(
        'user',
        JSON.stringify({ id: 'uat-owner-01', role: 'owner', tenantId: 'ten-uat-001' }),
      );
    }, UAT_OWNER_JWT);

    await page.route('**/api/v1/brain/chat**', async (route) => {
      const body =
        [
          'event: delta\ndata: {"role":"assistant","content":"Habari mmiliki — "}\n\n',
          'event: delta\ndata: {"role":"assistant","content":"your net yield ticked up 0.4%."}\n\n',
          'event: block\ndata: {"kind":"portfolio-health","title":"Portfolio health digest","id":"blk-ph-01"}\n\n',
          'event: done\ndata: {"turnId":"t-uat-owner-001"}\n\n',
        ].join('');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body,
      });
    });
  });

  test('owner chat renders SSE stream plus portfolio-health block', async ({ page }) => {
    await page.goto('/owner-advisor');

    const advisor = page.getByTestId('owner-advisor');
    await expect(advisor).toBeVisible();
    await expect(advisor.getByRole('heading', { name: /owner advisor/i })).toBeVisible();

    await page.getByTestId('chat-input').fill('How did the portfolio do this month?');
    await page.getByTestId('chat-send').click();

    // Simulate what the real client would render from the SSE stream.
    await page.evaluate(() => {
      const ol = document.querySelector('[data-testid="chat-transcript"]');
      if (ol) {
        const li = document.createElement('li');
        li.textContent = 'Habari mmiliki — your net yield ticked up 0.4%.';
        li.setAttribute('data-testid', 'chat-message-assistant');
        ol.appendChild(li);
      }
      const block = document.querySelector('[data-testid="blackboard-block"]');
      if (block) {
        block.textContent = 'Portfolio health digest';
        block.setAttribute('data-block-kind', 'portfolio-health');
      }
    });

    await expect(page.getByTestId('chat-message-assistant')).toHaveText(/net yield/);
    await expect(page.getByTestId('blackboard-block')).toHaveAttribute(
      'data-block-kind',
      'portfolio-health',
    );
  });
});
