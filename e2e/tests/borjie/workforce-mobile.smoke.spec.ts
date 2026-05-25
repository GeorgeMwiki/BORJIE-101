import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WORKFORCE_MOBILE_URL } from './fixtures/test-users';

/**
 * workforce-mobile smoke (Expo Router app).
 *
 * Strategy: static-source check (option b) by default — verifies the
 * expected expo-router screens exist and that the role picker exposes
 * owner/manager/employee. The Expo web export takes 60-90s to build, so
 * we keep the static path as the always-on smoke and gate a richer
 * runtime probe behind `EXPO_WEB_AVAILABLE=1`.
 */

const APP_ROOT = path.resolve(
  __dirname,
  '../../../apps/workforce-mobile/app',
);

const REQUIRED_ROUTES: ReadonlyArray<string> = [
  '_layout.tsx',
  'index.tsx',
  'onboarding/role.tsx',
  '(tabs)/_layout.tsx',
  '(tabs)/home.tsx',
];

const REQUIRED_ROLES: ReadonlyArray<string> = ['owner', 'manager', 'employee'];

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function expoWebReachable(page: Page): Promise<boolean> {
  if (process.env['EXPO_WEB_AVAILABLE'] !== '1') return false;
  try {
    const response = await page.request.get(WORKFORCE_MOBILE_URL, {
      timeout: 5000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

test.describe('Borjie workforce-mobile smoke (static)', () => {
  test('expo-router has the expected screens', async () => {
    for (const route of REQUIRED_ROUTES) {
      const exists = await fileExists(path.join(APP_ROOT, route));
      expect(exists, `missing route file: ${route}`).toBe(true);
    }
  });

  test('role picker source declares owner, manager, employee', async () => {
    const rolesTypesPath = path.resolve(
      __dirname,
      '../../../apps/workforce-mobile/src/roles/types.ts',
    );
    const source = await fs.readFile(rolesTypesPath, 'utf8');
    for (const role of REQUIRED_ROLES) {
      expect(source, `missing role literal: ${role}`).toContain(`'${role}'`);
    }
    expect(source).toMatch(/export\s+const\s+ALL_ROLES/);
  });

  test('owner tabs and worker tabs both exist in (tabs)', async () => {
    const tabsDir = path.join(APP_ROOT, '(tabs)');
    const entries = await fs.readdir(tabsDir);
    const tsxTabs = entries.filter((name) => name.endsWith('.tsx'));
    expect(tsxTabs.length).toBeGreaterThanOrEqual(3);
    expect(tsxTabs).toContain('home.tsx');
  });
});

test.describe('Borjie workforce-mobile smoke (runtime)', () => {
  test.beforeEach(async ({ page }) => {
    const reachable = await expoWebReachable(page);
    test.skip(
      !reachable,
      'Expo web export not running. Set EXPO_WEB_AVAILABLE=1 and serve via `expo export -p web`.',
    );
  });

  test('app loads without console errors and shows role picker', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(`${WORKFORCE_MOBILE_URL}/onboarding/role`);
    await expect(page.getByText(/owner/i).first()).toBeVisible();
    await expect(page.getByText(/manager/i).first()).toBeVisible();
    await expect(page.getByText(/employee|driver/i).first()).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
