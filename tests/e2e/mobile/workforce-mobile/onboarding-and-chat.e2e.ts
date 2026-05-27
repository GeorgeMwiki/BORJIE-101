/**
 * workforce-mobile — Detox spec (PLACEHOLDER, not yet wired).
 *
 * Detox is not installed in `apps/workforce-mobile` (see
 * `tests/e2e/mobile/README.md`). This file documents the four
 * pre-launch flows the mining ops team needs once Detox is added:
 *
 *   1. Onboarding wizard, ten role-aware steps end-to-end
 *   2. Activation via 6-digit invite code → lands on role home
 *   3. Home chat send → response bubble + tool card render
 *   4. Dashboard tab is role-aware (owner/manager/employee variants)
 *
 * IMPORTANT: This file is intentionally typed against a placeholder
 * `detox` module so `tsc --noEmit` is a no-op (no resolution attempt
 * unless `detox` is actually installed). When the real Detox lands
 * in the workspace, delete the `declare module` block at the top
 * and the existing `device` / `element` / `by` imports light up
 * automatically.
 */

// @ts-expect-error — Detox is not yet installed; suite is documentation-only.
import { device, element, by, expect as detoxExpect } from 'detox';

describe('workforce-mobile — onboarding & chat', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { camera: 'YES', location: 'inuse' },
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('1) onboarding wizard — 10 role-aware steps complete', async () => {
    /* Steps 1..10: role pick → name → phone → OTP → site → shift
     * preferences → notification opt-in → policy review → photo
     * advisor consent → finish. testIDs are derived from the
     * `onboarding-step-{n}` convention used by the wizard. */
    for (let stepIndex = 1; stepIndex <= 10; stepIndex += 1) {
      await detoxExpect(
        element(by.id(`onboarding-step-${stepIndex}`)),
      ).toBeVisible();
      await element(by.id(`onboarding-next-${stepIndex}`)).tap();
    }
    await detoxExpect(element(by.id('home-chat-root'))).toBeVisible();
  });

  it('2) activation via 6-digit code → role home', async () => {
    await element(by.id('activation-code-input')).typeText('123456');
    await element(by.id('activation-submit')).tap();
    await detoxExpect(element(by.id('home-chat-root'))).toBeVisible();
  });

  it('3) home chat — send a message → assistant reply', async () => {
    await element(by.id('home-chat-input')).typeText('Habari za leo?');
    await element(by.id('home-chat-send')).tap();
    await detoxExpect(
      element(by.id('home-chat-turn-assistant')),
    ).toBeVisible();
  });

  it('4) dashboard tab is role-aware (manager variant)', async () => {
    await element(by.id('tab-dashboard')).tap();
    /* Manager dashboard mounts `manager-dashboard`; owner mounts
     * `owner-home-kpi-strip`; employee mounts the shift hero. We
     * accept any one of the three so the suite is role-agnostic. */
    await detoxExpect(
      element(by.id('manager-dashboard'))
        .withAncestor(by.id('app-root'))
        .or(element(by.id('owner-home-kpi-strip')))
        .or(element(by.id('employee-home-clock-in'))),
    ).toBeVisible();
  });
});
