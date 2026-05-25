import { type Page } from '@playwright/test';

/**
 * Common E2E test helpers for BORJIE platform.
 */

/** Wait for network to be idle (no requests for 500ms). */
export async function waitForNetworkIdle(page: Page, timeout = 5000) {
  await page.waitForLoadState('networkidle');
}

/** Fill a form field by label text. */
export async function fillByLabel(page: Page, label: string | RegExp, value: string) {
  await page.getByLabel(label).fill(value);
}

/** Select option by label text. */
export async function selectByLabel(page: Page, label: string | RegExp, value: string) {
  await page.getByLabel(label).selectOption(value);
}

/** Click a button by text. */
export async function clickButton(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name }).click();
}

/** Wait for a toast or success message. */
export async function waitForSuccessMessage(page: Page, text?: string | RegExp) {
  const selector = text
    ? page.getByText(text)
    : page.locator('[class*="success"], [class*="toast"]');
  await selector.waitFor({ state: 'visible', timeout: 5000 });
}
