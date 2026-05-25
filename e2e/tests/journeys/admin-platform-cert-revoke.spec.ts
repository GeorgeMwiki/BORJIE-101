/**
 * Wave-2 deep-scrub journey: admin-web /integrations cert
 * revoke dialog sends the operator's reason in the DELETE body.
 *
 * This is a regression target — the original Vite admin-portal version
 * shipped DELETE without a body, so the platform audit log lost the
 * "why". The migrated Next.js client (IntegrationsClient.tsx) wraps
 * `api.delete(path, { reason })`, which JSON-stringifies the body for
 * fetch. This spec asserts:
 *
 *   1. The list of certifications loads from /agent-certifications.
 *   2. Clicking "Revoke" opens an alertdialog with a reason input.
 *   3. The "Confirm revoke" button is disabled until the operator types.
 *   4. Confirming fires DELETE /agent-certifications/:id with a JSON body
 *      that contains `{ reason: "<typed text>" }`.
 *   5. After success the list re-fetches and the cert is gone.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  fulfillJson,
  ok,
  seedPlatformAuth,
  screenshotCheckpoint,
} from './_helpers';

const PLATFORM_BASE_URL = process.env.ADMIN_PORTAL_URL ?? 'http://localhost:3001';

const CERTS_INITIAL = [
  {
    id: 'cert_aaa',
    agentId: 'agent-zapier-1',
    scopes: ['read:property', 'read:lease'],
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    revokedAt: null,
  },
  {
    id: 'cert_bbb',
    agentId: 'agent-make-1',
    scopes: ['read:tenant'],
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    revokedAt: null,
  },
];

test.describe('admin-web cert revoke @journeys', () => {
  test.use({ baseURL: PLATFORM_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real admin-web dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedPlatformAuth(page);
  });

  test('revoke dialog sends the typed reason in the DELETE body', async ({ page }) => {
    let store = [...CERTS_INITIAL];
    let capturedDeleteBody: string | null = null;

    await page.route('**/api/v1/agent-certifications**', async (route, request) => {
      const url = request.url();
      const method = request.method();

      if (method === 'DELETE' && /\/agent-certifications\/cert_aaa/.test(url)) {
        capturedDeleteBody = request.postData(); // DELETE body, JSON-encoded
        store = store.filter((c) => c.id !== 'cert_aaa'); // immutable
        return fulfillJson(route, ok({ id: 'cert_aaa', revokedAt: new Date().toISOString() }));
      }

      if (/\/agent-certifications\/revocations/.test(url)) {
        return fulfillJson(route, ok([]));
      }

      // GET list
      return fulfillJson(route, ok(store));
    });

    await page.goto('/integrations');
    await page.waitForLoadState('domcontentloaded');

    // Both certs are visible.
    await expect(page.getByText('agent-zapier-1')).toBeVisible();
    await expect(page.getByText('agent-make-1')).toBeVisible();

    // Click Revoke on the first one. Multiple Revoke buttons exist (one per
    // cert), so scope by row.
    const firstRow = page
      .getByRole('listitem')
      .filter({ hasText: 'agent-zapier-1' });
    await firstRow.getByRole('button', { name: /revoke/i }).click();

    // The alertdialog opens.
    const dialog = page.getByRole('alertdialog', { name: /revoke certification/i });
    await expect(dialog).toBeVisible();

    // Confirm button is disabled until the operator types a reason.
    const confirmBtn = dialog.getByRole('button', { name: /confirm revoke/i });
    await expect(confirmBtn).toBeDisabled();

    await dialog.getByLabel(/reason/i).fill('Compromised at vendor — emergency revoke');
    await expect(confirmBtn).toBeEnabled();

    await screenshotCheckpoint(page, 'cert-revoke-dialog');

    await confirmBtn.click();

    // The DELETE body carried our JSON reason payload.
    expect(capturedDeleteBody, 'DELETE body was empty — regression!').not.toBeNull();
    const parsed = JSON.parse(capturedDeleteBody ?? '{}') as { reason: string };
    expect(parsed.reason).toBe('Compromised at vendor — emergency revoke');

    // After the revoke the cert disappears and the dialog closes.
    await expect(page.getByText('agent-zapier-1')).toBeHidden();
    await expect(page.getByText('agent-make-1')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toBeHidden();
  });

  test('cancelling the revoke dialog leaves the cert intact', async ({ page }) => {
    await page.route('**/api/v1/agent-certifications**', async (route) => {
      const url = route.request().url();
      if (/\/revocations/.test(url)) return fulfillJson(route, ok([]));
      return fulfillJson(route, ok(CERTS_INITIAL));
    });

    await page.goto('/integrations');

    const firstRow = page
      .getByRole('listitem')
      .filter({ hasText: 'agent-zapier-1' });
    await firstRow.getByRole('button', { name: /revoke/i }).click();

    const dialog = page.getByRole('alertdialog', { name: /revoke certification/i });
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('agent-zapier-1')).toBeVisible();
  });

  test('issuing a new cert reloads the list', async ({ page }) => {
    let store = [...CERTS_INITIAL];

    await page.route('**/api/v1/agent-certifications**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (/\/revocations/.test(url)) return fulfillJson(route, ok([]));
      if (method === 'POST') {
        const body = request.postDataJSON() as { agentId: string; scopes: string[]; validForMs: number };
        const newCert = {
          id: 'cert_new',
          agentId: body.agentId,
          scopes: body.scopes,
          expiresAt: new Date(Date.now() + body.validForMs).toISOString(),
          createdAt: new Date().toISOString(),
          revokedAt: null,
        };
        store = [...store, newCert];
        return fulfillJson(route, ok(newCert), 201);
      }
      return fulfillJson(route, ok(store));
    });

    await page.goto('/integrations');
    await page.getByLabel(/agent id/i).fill('agent-newco-1');
    await page.getByRole('button', { name: /^issue$/i }).click();
    await expect(page.getByText('agent-newco-1')).toBeVisible();
  });
});
