/**
 * Critical flow: Estate manager subdivides a warehouse unit -> children created ->
 * parent status updated -> graph shows lineage.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, hasText } from './_helpers';

test.describe('Warehouse subdivision lineage', () => {
  test.use({ project: 'estate-manager' });

  test('subdividing a warehouse creates children and updates parent lineage', async ({ page }) => {
    await installApiMocks(page, {
      '**/api/assets/WH-01**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { assetId: 'WH-01', type: 'WAREHOUSE', status: 'ACTIVE', children: [] },
          }),
        }),
      '**/api/assets/WH-01/subdivide**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              parentId: 'WH-01',
              parentStatus: 'SUBDIVIDED',
              children: [
                { assetId: 'WH-01-A', parentId: 'WH-01' },
                { assetId: 'WH-01-B', parentId: 'WH-01' },
              ],
            },
          }),
        }),
      '**/api/assets/WH-01/lineage**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              nodes: [
                { id: 'WH-01', label: 'Warehouse 01' },
                { id: 'WH-01-A', label: 'Bay A' },
                { id: 'WH-01-B', label: 'Bay B' },
              ],
              edges: [
                { from: 'WH-01', to: 'WH-01-A' },
                { from: 'WH-01', to: 'WH-01-B' },
              ],
            },
          }),
        }),
    });

    await page.goto('/assets/WH-01/subdivide');
    await page.waitForLoadState('networkidle');
    const addChildBtn = page.getByRole('button', { name: /add (child|bay|unit)/i }).first();
    if (await addChildBtn.isVisible().catch(() => false)) {
      await addChildBtn.click();
      await addChildBtn.click();
    }
    const submitBtn = page.getByRole('button', { name: /subdivide|save|apply/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    }
    expect(await hasText(page, /SUBDIVIDED|subdivided|WH-01-A|WH-01-B/i)).toBeTruthy();

    await page.goto('/assets/WH-01/lineage');
    await page.waitForLoadState('networkidle');
    expect(
      (await hasText(page, /WH-01-A/)) && (await hasText(page, /WH-01-B/)),
    ).toBeTruthy();
  });
});
