import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BUYER_MOBILE_URL } from './fixtures/test-users';

/**
 * buyer-mobile smoke (Expo Router app).
 *
 * Static-first strategy mirrors workforce-mobile: confirm the expected
 * marketplace / bids / parcel-detail routes exist in source, plus mock
 * listings for gold / tanzanite / coltan are present in the fixtures.
 * Runtime probe behind `EXPO_WEB_AVAILABLE=1`.
 */

const APP_ROOT = path.resolve(__dirname, '../../../apps/buyer-mobile/app');
const SRC_ROOT = path.resolve(__dirname, '../../../apps/buyer-mobile/src');

const REQUIRED_ROUTES: ReadonlyArray<string> = [
  '_layout.tsx',
  'index.tsx',
  '(tabs)/_layout.tsx',
  '(tabs)/marketplace/index.tsx',
  'marketplace/[id].tsx',
  'bids/[id].tsx',
];

const REQUIRED_MINERALS: ReadonlyArray<RegExp> = [
  /gold/i,
  /tanzanite/i,
  /coltan/i,
];

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readAllSourceText(root: string): Promise<string> {
  const queue: string[] = [root];
  const chunks: string[] = [];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) continue;
    let entries: ReadonlyArray<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        queue.push(full);
      } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
        try {
          chunks.push(await fs.readFile(full, 'utf8'));
        } catch {
          // skip unreadable file
        }
      }
    }
  }
  return chunks.join('\n');
}

async function expoWebReachable(page: Page): Promise<boolean> {
  if (process.env['EXPO_WEB_AVAILABLE'] !== '1') return false;
  try {
    const response = await page.request.get(BUYER_MOBILE_URL, {
      timeout: 5000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

test.describe('Borjie buyer-mobile smoke (static)', () => {
  test('expo-router exposes marketplace, parcel, bids routes', async () => {
    for (const route of REQUIRED_ROUTES) {
      const exists = await fileExists(path.join(APP_ROOT, route));
      expect(exists, `missing route file: ${route}`).toBe(true);
    }
  });

  test('marketplace fixtures reference gold, tanzanite, coltan', async () => {
    const allSource = await readAllSourceText(SRC_ROOT);
    for (const mineral of REQUIRED_MINERALS) {
      expect(allSource, `marketplace fixtures missing ${mineral}`).toMatch(
        mineral,
      );
    }
  });

  test('parcel detail and Place Bid affordances present in source', async () => {
    const detailSrc = await fs.readFile(
      path.join(APP_ROOT, 'marketplace/[id].tsx'),
      'utf8',
    );
    expect(detailSrc).toMatch(/bid|offer/i);

    const bidsSrc = await fs.readFile(
      path.join(APP_ROOT, 'bids/[id].tsx'),
      'utf8',
    );
    expect(bidsSrc.length).toBeGreaterThan(0);
  });
});

test.describe('Borjie buyer-mobile smoke (runtime)', () => {
  test.beforeEach(async ({ page }) => {
    const reachable = await expoWebReachable(page);
    test.skip(
      !reachable,
      'Expo web export not running. Set EXPO_WEB_AVAILABLE=1 and serve via `expo export -p web`.',
    );
  });

  test('marketplace lists 3+ listings and parcel detail shows Place Bid', async ({
    page,
  }) => {
    await page.goto(`${BUYER_MOBILE_URL}/(tabs)/marketplace`);
    const listings = page.locator(
      '[data-testid="listing-card"], [role="button"][aria-label*="listing" i]',
    );
    const count = await listings.count();
    expect(count).toBeGreaterThanOrEqual(3);

    await listings.first().click();
    await expect(page.getByText(/place bid|place offer/i).first()).toBeVisible();
  });
});
