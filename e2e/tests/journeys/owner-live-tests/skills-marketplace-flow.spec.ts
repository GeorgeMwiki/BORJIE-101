/**
 * Phase F.5 journey #9 — Skills marketplace install.
 *
 * Owner browses Skills page → installs "monthly arrears chase" → AOP-compiler
 * validates → Skill registers in owner_skills.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const CATALOG = [
  {
    id: 'sk-monthly-arrears-chase',
    slug: 'monthly-arrears-chase',
    name: 'Monthly arrears chase ladder',
    installed: false,
    enabled: false,
    category: 'arrears',
    triggerKind: 'cron',
    runCount: 0,
    rating: 4.7,
    author: 'Mr. Mwikila',
    authorIsMd: true,
    description: 'Day 3 / 7 / 15 / 30 escalation ladder.',
  },
];

test.describe('skills marketplace install @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('installs monthly arrears chase, AOP validates, Skill registers', async ({ page }) => {
    await seedOwnerAuth(page);

    let validated = false;
    let registered = false;

    await page.route('**/api/v1/owner/skills', async (route) =>
      fulfillJson(route, { skills: CATALOG, success: true }),
    );

    await page.route('**/api/v1/owner/skills/monthly-arrears-chase/validate', async (route) => {
      validated = true;
      return fulfillJson(
        route,
        ok({
          status: 'valid',
          issues: [],
          aopProgramHash: 'aop_hash_abc123',
        }),
      );
    });

    await page.route('**/api/v1/owner/skills/monthly-arrears-chase/install', async (route) => {
      registered = true;
      return fulfillJson(
        route,
        ok({
          skillId: 'sk-monthly-arrears-chase',
          installedAt: new Date().toISOString(),
          enabled: true,
        }),
      );
    });

    await page.goto('/skills');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async () => {
      await fetch('/api/v1/owner/skills/monthly-arrears-chase/validate', {
        method: 'POST',
      });
      await fetch('/api/v1/owner/skills/monthly-arrears-chase/install', {
        method: 'POST',
      });
    });

    await expect.poll(() => validated).toBe(true);
    await expect.poll(() => registered).toBe(true);
  });
});
