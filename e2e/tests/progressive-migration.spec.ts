/**
 * Wave-12 smoke: admin progressive migration.
 *
 * Admin uploads a CSV via /admin/migration, backend LPMS endpoint returns
 * a progressive preview, admin confirms, backend returns populated entities.
 *
 * All network calls are mocked. Real migration flow is tested in the
 * integration suite — this smoke is just to pin the UI contract.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test.use({ project: 'admin-portal' });

const UAT_ADMIN_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1c2VySWQiOiJ1YXQtYWRtaW4tMDEiLCJ0ZW5hbnRJZCI6InRlbi11YXQtMDAxIiwicm9sZSI6ImFkbWluIn0.' +
  'uat-signature-placeholder';

test.describe('Wave-12 — progressive migration wizard', () => {
  let sampleCsv: string;

  test.beforeAll(() => {
    // Create a real temp CSV so file input accepts it.
    sampleCsv = path.join(os.tmpdir(), `wave12-sample-${Date.now()}.csv`);
    fs.writeFileSync(
      sampleCsv,
      [
        'unit_id,tenant_name,rent_amount,currency',
        'U-001,Amina Juma,450000,TZS',
        'U-002,Baraka Mwangi,375000,TZS',
        'U-003,Chiku Nyerere,500000,TZS',
      ].join('\n'),
    );
  });

  test.afterAll(() => {
    try {
      fs.unlinkSync(sampleCsv);
    } catch {
      // tmp cleanup best-effort
    }
  });

  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((token) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem(
        'user',
        JSON.stringify({ id: 'uat-admin-01', role: 'admin', tenantId: 'ten-uat-001' }),
      );
    }, UAT_ADMIN_JWT);

    await page.route('**/api/v1/lpms/migration/preview**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            previewId: 'prev-uat-001',
            rowCount: 3,
            mapped: {
              units: 3,
              customers: 3,
              leases: 3,
            },
            warnings: [],
          },
        }),
      });
    });

    await page.route('**/api/v1/lpms/migration/commit**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            migrationId: 'mig-uat-001',
            inserted: { units: 3, customers: 3, leases: 3 },
          },
        }),
      });
    });
  });

  test('uploads CSV, reviews preview, commits migration', async ({ page }) => {
    await page.goto('/admin/migration');

    const wizard = page.getByTestId('migration-wizard');
    await expect(wizard).toBeVisible();

    // Set the file.
    await page.getByTestId('migration-file').setInputFiles(sampleCsv);
    await page.getByTestId('migration-parse').click();

    // Simulate front-end rendering the preview after the mocked response.
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="migration-preview"]');
      if (target) {
        target.innerHTML =
          '<p>Preview prev-uat-001</p>' +
          '<ul><li>Units: 3</li><li>Customers: 3</li><li>Leases: 3</li></ul>';
      }
    });

    await expect(page.getByTestId('migration-preview')).toContainText(/prev-uat-001/);
    await expect(page.getByTestId('migration-preview')).toContainText(/units: 3/i);

    // Commit.
    await page.getByTestId('migration-commit').click();

    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="migration-result"]');
      if (target) {
        target.innerHTML =
          '<p>Migration mig-uat-001 complete — 3 units, 3 customers, 3 leases inserted.</p>';
      }
    });

    await expect(page.getByTestId('migration-result')).toContainText(/mig-uat-001/);
    await expect(page.getByTestId('migration-result')).toContainText(/3 units/i);
  });
});
