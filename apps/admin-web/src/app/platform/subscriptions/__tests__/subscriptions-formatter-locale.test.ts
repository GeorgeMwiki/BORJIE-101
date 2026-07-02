/**
 * Static-source regression guard — the platform Subscriptions table must
 * render its "Period end" date through the ACTIVE operator locale, not a
 * deterministic 'en' default.
 *
 * `formatDate(date, locale = 'en')` in @/lib/api defaults its locale to
 * 'en'; calling it as `formatDate(sub.currentPeriodEnd)` renders the date
 * with English-by-omission month/day grouping even under the `sw` surface
 * (zero-mix canon violation). The active BCP-47 tag (`bcp47`, resolved from
 * the operator locale) must be threaded in.
 *
 * Reads the source as text so it needs no React renderer — it just asserts
 * the wiring shipped and cannot silently regress.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(__dirname, '..', 'SubscriptionsClient.tsx'),
  'utf8',
);

describe('SubscriptionsClient — Period end date threads the active locale', () => {
  it('never calls formatDate on currentPeriodEnd without a locale argument', () => {
    // The bare-single-argument form is the leak: it falls back to the
    // formatter's 'en' default and ignores the operator's chosen language.
    expect(SRC).not.toMatch(/formatDate\(\s*sub\.currentPeriodEnd\s*\)/);
  });

  it('passes the resolved bcp47 tag into the Period end render', () => {
    expect(SRC).toContain('formatDate(sub.currentPeriodEnd, bcp47)');
  });

  it('resolves bcp47 from the active locale (locale-follows-the-user)', () => {
    expect(SRC).toContain('const bcp47 = bcp47For(locale)');
  });
});
