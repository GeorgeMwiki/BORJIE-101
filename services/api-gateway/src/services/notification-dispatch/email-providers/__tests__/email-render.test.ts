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

  it('ignores a non-string subject and falls back honestly (unknown key)', () => {
    const subject = renderEmailSubject(
      input({
        templateKey: 'x.unknown',
        payload: { subject: 123 as unknown as string },
      }),
    );
    expect(subject).toBe('BORJIE: x.unknown');
  });

  it('renders the template-key map subject for a known key when subject is non-string', () => {
    const subject = renderEmailSubject(
      input({
        templateKey: 'owner.daily_brief',
        payload: { subject: 123 as unknown as string },
      }),
    );
    expect(subject).toBe('BORJIE: your daily brief');
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

// ---------------------------------------------------------------------------
// Template-key map (path 2): a known key + structured payload (no
// pre-rendered subject/html/body) renders real localized content.
// ---------------------------------------------------------------------------

describe('template-key map — licence.expiry_warning', () => {
  const licencePayload = {
    licenceId: 'lic_1',
    companyId: 'co_1',
    licenceKind: 'Primary Mining',
    licenceNumber: 'PML-2026-0042',
    mineral: 'gold',
    status: 'active',
    windowDays: 30,
    expiryDate: '2026-07-13T00:00:00.000Z',
  };

  function licenceInput(locale: string): EmailProviderInput {
    return input({
      templateKey: 'licence.expiry_warning',
      locale,
      payload: licencePayload,
    });
  }

  it('renders a real EN subject from the structured payload (not the generic stub)', () => {
    const subject = renderEmailSubject(licenceInput('en'));
    expect(subject).toBe('BORJIE: licence PML-2026-0042 is expiring soon');
    expect(subject).not.toBe('BORJIE: licence.expiry_warning');
  });

  it('renders a real EN body with the structured fields', () => {
    const html = renderEmailHtml(licenceInput('en'));
    expect(html).toContain('Primary Mining');
    expect(html).toContain('PML-2026-0042');
    expect(html).toContain('gold');
    expect(html).toContain('30 day(s) remain');
    // single-language: no Swahili leaks into the EN render
    expect(html).not.toMatch(/Leseni|siku/);
    expect(html).not.toContain('You have a new BORJIE notification');
  });

  it('renders a real SW subject + body when locale is sw (single-language)', () => {
    const subject = renderEmailSubject(licenceInput('sw'));
    expect(subject).toBe('BORJIE: leseni PML-2026-0042 inakaribia kuisha');

    const html = renderEmailHtml(licenceInput('sw'));
    expect(html).toContain('Leseni yako');
    expect(html).toContain('siku 30');
    // single-language: no English leaks into the SW render
    expect(html).not.toMatch(/licence|is expiring|day\(s\) remain/);
  });

  it('escapes interpolated payload values (no raw HTML injection)', () => {
    const html = renderEmailHtml(
      input({
        templateKey: 'licence.expiry_warning',
        locale: 'en',
        payload: {
          ...licencePayload,
          mineral: '<script>alert(1)</script>',
          licenceNumber: 'A&B"<x>',
        },
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B&quot;&lt;x&gt;');
  });

  it('explicit payload.subject still wins over the template-key map', () => {
    const subject = renderEmailSubject(
      input({
        templateKey: 'licence.expiry_warning',
        locale: 'en',
        payload: { ...licencePayload, subject: 'Pre-rendered subject' },
      }),
    );
    expect(subject).toBe('Pre-rendered subject');
  });
});

describe('template-key map — mining.incident.escalation.manager', () => {
  const incidentPayload = {
    incidentId: 'inc_1',
    leg: 'manager',
    severity: 'critical',
    summary: {
      en: 'Rockfall in shaft 3; two workers evacuated.',
      sw: 'Mporomoko wa miamba katika shimo la 3; wafanyakazi wawili wamehamishwa.',
    },
  };

  it('renders a real EN body from severity + summary when no pre-rendered fields', () => {
    const html = renderEmailHtml(
      input({
        templateKey: 'mining.incident.escalation.manager',
        locale: 'en',
        payload: incidentPayload,
      }),
    );
    expect(html).toContain('severity: critical');
    expect(html).toContain('Rockfall in shaft 3');
    expect(html).not.toMatch(/Mporomoko|Tukio la usalama/);
  });

  it('renders the SW summary leg when locale is sw (single-language)', () => {
    const subject = renderEmailSubject(
      input({
        templateKey: 'mining.incident.escalation.manager',
        locale: 'sw',
        payload: incidentPayload,
      }),
    );
    expect(subject).toBe(
      'BORJIE: arifa ya kupandishwa kwa tukio la usalama',
    );

    const html = renderEmailHtml(
      input({
        templateKey: 'mining.incident.escalation.manager',
        locale: 'sw',
        payload: incidentPayload,
      }),
    );
    expect(html).toContain('Mporomoko wa miamba');
    expect(html).not.toMatch(/Rockfall|severity:/);
  });
});

describe('template-key map — platform.announcement.broadcast', () => {
  it('renders a real localized subject for a known key with no pre-rendered subject', () => {
    const en = renderEmailSubject(
      input({
        templateKey: 'platform.announcement.broadcast',
        locale: 'en',
        payload: { announcementId: 'a1', scope: 'tenant' },
      }),
    );
    expect(en).toBe('BORJIE: platform announcement');

    const sw = renderEmailSubject(
      input({
        templateKey: 'platform.announcement.broadcast',
        locale: 'sw',
        payload: { announcementId: 'a1', scope: 'tenant' },
      }),
    );
    expect(sw).toBe('BORJIE: tangazo la jukwaa');
  });
});
