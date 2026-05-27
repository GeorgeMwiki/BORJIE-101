/**
 * buyer-mobile — Detox spec (PLACEHOLDER, not yet wired).
 *
 * Detox is not installed in `apps/buyer-mobile`. See
 * `tests/e2e/mobile/README.md` for the wiring steps. Once Detox is
 * configured this file moves under `apps/buyer-mobile/e2e/` and the
 * `declare module 'detox'` placeholder at the top is deleted.
 *
 * Three pre-launch flows for the mineral-buyer side of the marketplace:
 *
 *   1. Signup wizard — individual buyer + OTP verification
 *   2. Home chat asks "gold price today?" → reply with a quote card
 *   3. Marketplace bid — slide-to-confirm submits a sealed offer
 */

// @ts-expect-error — Detox is not yet installed; suite is documentation-only.
import { device, element, by, expect as detoxExpect } from 'detox';

describe('buyer-mobile — signup, chat & bid', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('1) signup wizard — individual buyer + OTP verify', async () => {
    await element(by.id('signup-kind-individual')).tap();
    await element(by.id('signup-individual-fullName')).typeText(
      'Asha Buyer',
    );
    await element(by.id('signup-individual-phone')).typeText('+255712345678');
    await element(by.id('signup-individual-email')).typeText(
      'asha+e2e@borjie.local',
    );
    await element(by.id('signup-individual-next')).tap();

    /* Step 2: OTP entry. Dev SMS bypass accepts 000000. */
    await element(by.id('signup-contact-otp')).typeText('000000');
    await element(by.id('signup-contact-verify')).tap();

    /* Land on home chat root after successful verify. */
    await detoxExpect(element(by.id('home-chat-root'))).toBeVisible();
  });

  it('2) home chat — ask gold price → quote card appears', async () => {
    await element(by.id('home-chat-input')).typeText('Bei ya dhahabu leo?');
    await element(by.id('home-chat-send')).tap();
    /* Tool card for the price-quote tool. */
    await detoxExpect(
      element(by.id('home-chat-tool-card-gold_price_quote')),
    ).toBeVisible();
  });

  it('3) marketplace bid — slide-to-confirm submits offer', async () => {
    await element(by.id('tab-marketplace')).tap();
    await element(by.id('marketplace-listing-0')).tap();
    await element(by.id('bid-amount-input')).typeText('1500');
    await element(by.id('bid-slide-to-confirm')).swipe('right', 'fast', 0.9);
    await detoxExpect(element(by.id('bid-submitted-toast'))).toBeVisible();
  });
});
