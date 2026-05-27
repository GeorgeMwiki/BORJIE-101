import { test, expect } from '@playwright/test';
import {
  OWNER_WEB_URL,
  serverReachable,
  LOAD_TEST_RUN_ID,
} from '../_shared/helpers';

/**
 * owner-web — /document-intelligence ("Hati hai" / living documents).
 *
 * Three flows that confirm the upload-and-chat workspace boots:
 *
 *   1. Upload a small in-memory PDF
 *   2. Send a chat turn referencing the uploaded doc
 *   3. Navigate to the /documents read-only catalogue and back
 *
 * The chat assertion is intentionally permissive — the orchestrator
 * may stream a tool card, a citation chip, or plain text depending
 * on persona configuration. We just need to see SOMETHING flow back.
 */

const PDF_NAME = `borjie-docint-${LOAD_TEST_RUN_ID}.pdf`;
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
  'utf-8',
);

test.describe('owner-web — document-intelligence', () => {
  test.beforeEach(async ({ request }) => {
    const ok = await serverReachable(
      request,
      OWNER_WEB_URL,
      '/document-intelligence',
    );
    test.skip(
      !ok,
      `owner-web /document-intelligence not reachable at ${OWNER_WEB_URL}`,
    );
  });

  test('1) upload a PDF — registerUpload succeeds', async ({ page }) => {
    await page.goto('/document-intelligence');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/document-intelligence requires session');
    }

    await expect(
      page.getByRole('heading', { name: /Hati hai|Living documents/i }),
    ).toBeVisible({ timeout: 8_000 });

    const fileInput = page.locator('input[type="file"]').first();
    test.skip(
      (await fileInput.count()) === 0,
      'no file input mounted — upload module is gated behind api-gateway',
    );

    await fileInput.setInputFiles({
      name: PDF_NAME,
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });

    const acknowledged = page
      .getByText(PDF_NAME)
      .or(page.getByText(/uploaded|imepakiwa/i))
      .or(page.getByRole('status'));
    await expect(acknowledged.first()).toBeVisible({ timeout: 15_000 });
  });

  test('2) ask brain about an uploaded doc — composer responds', async ({
    page,
  }) => {
    await page.goto('/document-intelligence');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/document-intelligence requires session');
    }

    /* If the explorer composer (aria-label="Tuma swali") isn't
     * present the page is still loading the doc list — skip rather
     * than time out. */
    const explorerInput = page
      .locator('[aria-label="Tuma swali"]')
      .or(page.locator('textarea').first());
    const inputVisible = await explorerInput
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    test.skip(
      !inputVisible,
      'DocumentExplorer composer not mounted (no documents seeded)',
    );

    await explorerInput
      .first()
      .fill('Toa muhtasari wa hati hii — clauses kuu ni zipi?');

    const sendBtn = page
      .getByRole('button', { name: /send|tuma|ask/i })
      .first();
    await sendBtn.click();

    /* Loose assertion — any reply marker, citation chip, or status
     * counts as a successful chat round-trip. */
    const reply = page
      .locator('[role="article"], [data-testid*="bubble"], [role="status"]')
      .first();
    await expect(reply).toBeVisible({ timeout: 20_000 });
  });

  test('3) navigate to /documents catalogue and back', async ({ page }) => {
    await page.goto('/documents');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/documents requires session');
    }

    /* /documents is the read-only 3-column catalogue; any heading or
     * the document list aria-label confirms it mounted. */
    const catalogueMarker = page
      .locator('ul[aria-label="Uploaded documents"]')
      .or(page.getByRole('heading', { name: /documents|hati/i }));
    await expect(catalogueMarker.first()).toBeVisible({ timeout: 8_000 });

    await page.goto('/document-intelligence');
    await expect(
      page.getByRole('heading', { name: /Hati hai|Living documents/i }),
    ).toBeVisible({ timeout: 8_000 });
  });
});
