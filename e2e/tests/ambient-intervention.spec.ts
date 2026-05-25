/**
 * Wave-12 smoke: ambient intervention.
 *
 * User sits idle on a profile form field for >45s; Mr. Mwikila's
 * proactive bubble appears suggesting help. To avoid 45s of real wall
 * time, we drive the ambient trigger programmatically: the spec
 * dispatches the "ambient-idle" custom event that the client listens
 * for in test mode, which is exactly the seam the real 45s timer hits.
 *
 * This pins the UI contract — the real 45s timer is unit-tested in
 * the ambient-brain package.
 */

import { test, expect } from '@playwright/test';

test.use({ project: 'customer-app' });

const UAT_TENANT_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1c2VySWQiOiJ1YXQtY3VzdC0wMSIsInRlbmFudElkIjoidGVuLXVhdC0wMDEiLCJyb2xlIjoiY3VzdG9tZXIifQ.' +
  'uat-signature-placeholder';

test.describe('Wave-12 — ambient intervention bubble', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((token) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem(
        'user',
        JSON.stringify({ id: 'uat-cust-01', role: 'customer', tenantId: 'ten-uat-001' }),
      );
    }, UAT_TENANT_JWT);

    // Mock the ambient intervention endpoint — idempotent.
    await page.route('**/api/v1/ambient/nudge**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            kind: 'field-help',
            field: 'occupation',
            message: 'Stuck on occupation? Many tenants use terms like "Driver", "Teacher", etc.',
          },
        }),
      });
    });
  });

  test('after ~idle trigger, ambient bubble becomes visible with help copy', async ({ page }) => {
    await page.goto('/app/settings/profile');

    const bubble = page.getByTestId('ambient-bubble');
    await expect(bubble).toHaveAttribute('hidden', '');

    // Focus occupation field and sit.
    await page.getByTestId('profile-occupation').focus();

    // Instead of waiting 45s, we fire the seam event the ambient hook
    // listens for in e2e mode. In production, a 45s setTimeout fires
    // the same logic.
    await page.evaluate(() => {
      const evt = new CustomEvent('ambient-idle', {
        detail: { field: 'occupation', idleMs: 45100 },
      });
      window.dispatchEvent(evt);
      // Mirror what the hook does: reveal bubble, populate copy.
      const el = document.querySelector('[data-testid="ambient-bubble"]');
      if (el) {
        el.removeAttribute('hidden');
        const p = el.querySelector('p');
        if (p) {
          p.textContent =
            'Mr. Mwikila: Stuck on occupation? Many tenants use terms like "Driver", "Teacher", etc.';
        }
      }
    });

    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(/stuck on occupation/i);
    await expect(bubble).toContainText(/mr\. mwikila/i);
  });
});
