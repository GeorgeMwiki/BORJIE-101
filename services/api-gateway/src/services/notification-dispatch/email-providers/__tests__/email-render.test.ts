/**
 * Tests for the shared email render logic.
 *
 * Pins the SLICE A1 contract: pre-rendered `payload.subject` /
 * `payload.html` / `payload.bodyHtml` flow through verbatim (so the
 * daily-brief cron's real content is no longer discarded), with an
 * honest, locale-pure fallback when the payload carries nothing.
 */
import { describe, it, expect } from 'vitest';

import { renderEmailHtml, renderEmailSubject } from '../email-render';
import type { EmailProviderInput } from '../../email-provider';

function input(over: Partial<EmailProviderInput> = {}): EmailProviderInput {
  return {
    tenantId: 'tenant-A',
    recipientAddress: 'owner@example.com',
    templateKey: 'owner.daily_brief',
    locale: 'en',
    payload: {},
    idempotencyKey: 'idem-1',
    ...over,
  };
}

describe('renderEmailSubject', () => {
  it('honors a pre-rendered payload.subject verbatim', () => {
    const subject = renderEmailSubject(
      input({ payload: { subject: 'Mr. Mwikila — daily brief for 2026-06-13' } }),
    );
    expect(subject).toBe('Mr. Mwikila — daily brief for 2026-06-13');
  });

  it('falls back to payload.title when no subject (reminders)', () => {
    const subject = renderEmailSubject(
      input({ payload: { title: 'Licence renewal due' } }),
    );
    expect(subject).toBe('Licence renewal due');
  });

  it('falls back to BORJIE: <templateKey> when payload has neither', () => {
    expect(renderEmailSubject(input({ templateKey: 'arrears.reminder' }))).toBe(
      'BORJIE: arrears.reminder',
    );
  });

  it('ignores a non-string subject and falls back honestly', () => {
    const subject = renderEmailSubject(
      input({ payload: { subject: 123 as unknown as string } }),
    );
    expect(subject).toBe('BORJIE: owner.daily_brief');
  });
});

describe('renderEmailHtml', () => {
  it('honors a pre-rendered payload.html verbatim', () => {
    const html = '<html><body><h1>Daily brief</h1></body></html>';
    expect(renderEmailHtml(input({ payload: { html } }))).toBe(html);
  });

  it('honors payload.bodyHtml (the daily-brief producer field)', () => {
    const bodyHtml = '<div>Today: gold 62oz, 3 actions.</div>';
    expect(renderEmailHtml(input({ payload: { bodyHtml } }))).toBe(bodyHtml);
  });

  it('prefers payload.html over payload.bodyHtml when both present', () => {
    const html = '<p>canonical</p>';
    const bodyHtml = '<p>secondary</p>';
    expect(renderEmailHtml(input({ payload: { html, bodyHtml } }))).toBe(html);
  });

  it('escapes plaintext payload.body into a <p> when no html present', () => {
    const html = renderEmailHtml(
      input({ payload: { body: 'A & B <script>x</script>' } }),
    );
    expect(html).toBe('<p>A &amp; B &lt;script&gt;x&lt;/script&gt;</p>');
    expect(html).not.toContain('<script>');
  });

  it('emits a single-language EN fallback when payload is empty', () => {
    const html = renderEmailHtml(input({ locale: 'en', templateKey: 'x.y' }));
    expect(html).toContain('You have a new BORJIE notification');
    expect(html).not.toMatch(/arifa/);
  });

  it('emits a single-language SW fallback when locale is sw', () => {
    const html = renderEmailHtml(input({ locale: 'sw', templateKey: 'x.y' }));
    expect(html).toContain('Una arifa mpya');
    expect(html).not.toMatch(/You have a new/);
  });
});
