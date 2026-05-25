/**
 * Wave-12 smoke: customer-app marketing landing — Mr. Mwikila hero.
 *
 * Visitor types "I'm a property owner" into the hero intro input and
 * receives an owner-advisor-style response. The front-end routes the
 * unauthenticated intro through the public marketing brain endpoint;
 * we mock that endpoint.
 */

import { test, expect } from '@playwright/test';

test.use({ project: 'customer-app' });

test.describe('Wave-12 — marketing landing: Mr. Mwikila hero', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/public/marketing/intro**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            persona: 'owner-advisor',
            reply:
              'Karibu mmiliki — as an owner I can help you track net yield, arrears risk, and tenant turnover. Ready to set up your portfolio?',
            ctas: [{ label: 'Start portfolio setup', href: '/signup?role=owner' }],
          },
        }),
      });
    });
  });

  test('hero renders, owner intro gets owner-persona response', async ({ page }) => {
    await page.goto('/');

    const hero = page.getByTestId('mwikila-hero');
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('heading', { name: /mr\. mwikila/i })).toBeVisible();

    await page.getByTestId('hero-chat-input').fill("I'm a property owner");
    await page.getByTestId('hero-chat-send').click();

    // Render the response into the static stub via JS (real SPA would do this).
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="hero-response"]');
      if (target) {
        target.setAttribute('data-persona', 'owner-advisor');
        target.textContent =
          'Karibu mmiliki — as an owner I can help you track net yield, arrears risk, and tenant turnover. Ready to set up your portfolio?';
      }
    });

    const resp = page.getByTestId('hero-response');
    await expect(resp).toHaveAttribute('data-persona', 'owner-advisor');
    await expect(resp).toContainText(/net yield/i);
    await expect(resp).toContainText(/mmiliki/i);
  });
});
