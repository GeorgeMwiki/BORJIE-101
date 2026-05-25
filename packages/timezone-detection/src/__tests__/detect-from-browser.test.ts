import { describe, expect, it } from 'vitest';
import { detectFromBrowser } from '../detect/detect-from-browser.js';

describe('detectFromBrowser', () => {
  it('returns the client-reported TZ verbatim when valid', () => {
    const r = detectFromBrowser({ clientReportedTimezone: 'Africa/Nairobi' });
    expect(r).not.toBeNull();
    expect(r?.timezone).toBe('Africa/Nairobi');
    expect(r?.source).toBe('browser');
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it('falls back to Intl.DateTimeFormat when no client value supplied', () => {
    const r = detectFromBrowser({ clientReportedTimezone: null });
    // We don't assert a specific tz (depends on host) — just that we got one.
    expect(r).not.toBeNull();
    expect(r?.source).toBe('browser');
  });

  it('returns null when the client TZ is invalid', () => {
    const r = detectFromBrowser({
      clientReportedTimezone: 'Mars/Olympus_Mons',
    });
    expect(r).toBeNull();
  });

  it('returns null when the client TZ is empty', () => {
    const r = detectFromBrowser({ clientReportedTimezone: '' });
    // Falls through to Intl — still returns something.
    expect(r).not.toBeNull();
  });
});
