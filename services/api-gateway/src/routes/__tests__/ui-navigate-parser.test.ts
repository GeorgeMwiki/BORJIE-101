/**
 * ui-navigate-parser - smoke test for the 6 superpower chip families.
 *
 * Confirms that:
 *   - well-formed chips are extracted and stripped from the body
 *   - malformed chips are dropped silently and incremented in `dropped`
 *   - the body is always returned with the tags removed
 *   - the per-family cap absorbs prompt drift
 */

import { describe, expect, it } from 'vitest';
import { parseSuperpowers } from '../ui-navigate-parser';

describe('parseSuperpowers', () => {
  it('extracts a single ui_navigate chip and strips the tag', () => {
    const text =
      'You asked about expiring PMLs. <ui_navigate>{"route":"/licences","scopeIds":["geita"],"focus":"expiring-90d","reason":"Open the Licences tab."}</ui_navigate> Tap below to jump.';
    const result = parseSuperpowers(text);

    expect(result.navigates).toHaveLength(1);
    expect(result.navigates[0]?.route).toBe('/licences');
    expect(result.navigates[0]?.focus).toBe('expiring-90d');
    expect(result.body).not.toContain('<ui_navigate>');
    expect(result.body).toContain('You asked about expiring PMLs.');
    expect(result.body).toContain('Tap below to jump.');
    expect(result.dropped).toBe(0);
  });

  it('extracts multiple chip families in one pass', () => {
    const text =
      '<ui_share>{"entityType":"draft","entityId":"d_42","expiresInHours":24,"permission":"read"}</ui_share>' +
      '<ui_bookmark>{"entityType":"licence","entityId":"pml_0241"}</ui_bookmark>' +
      '<ui_highlight>{"selector":"[data-tour=\\"x\\"]","message":{"en":"Click here.","sw":"Bonyeza hapa."}}</ui_highlight>';
    const result = parseSuperpowers(text);

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0]?.entityType).toBe('draft');
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]?.entityType).toBe('licence');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]?.selector).toBe('[data-tour="x"]');
    expect(result.body.trim()).toBe('');
  });

  it('drops malformed JSON silently and strips the tag', () => {
    // The body-pattern requires the {...} shape; if the payload is a
    // bracey blob that fails JSON.parse we still strip it.
    const text =
      'Before <ui_navigate>{ route: "/x", missing-quotes }</ui_navigate> after';
    const result = parseSuperpowers(text);

    expect(result.navigates).toHaveLength(0);
    expect(result.dropped).toBe(1);
    expect(result.body).not.toContain('<ui_navigate>');
    expect(result.body).toContain('Before');
    expect(result.body).toContain('after');
  });

  it('drops schema-fail entries (e.g. route missing leading slash)', () => {
    const text =
      '<ui_navigate>{"route":"missing-slash","reason":"bad"}</ui_navigate>';
    const result = parseSuperpowers(text);

    expect(result.navigates).toHaveLength(0);
    expect(result.dropped).toBe(1);
    expect(result.body.trim()).toBe('');
  });

  it('refuses ui_bulk action outside whitelist', () => {
    const text =
      '<ui_bulk>{"entityType":"reminders","ids":["r1"],"action":"complete","reason":"x"}</ui_bulk>';
    const result = parseSuperpowers(text);

    // tasks.complete is allowed, reminders.complete is NOT.
    expect(result.bulks).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it('accepts ui_bulk action inside whitelist', () => {
    const text =
      '<ui_bulk>{"entityType":"reminders","ids":["r1","r2"],"action":"snooze","reason":"x"}</ui_bulk>';
    const result = parseSuperpowers(text);

    expect(result.bulks).toHaveLength(1);
    expect(result.bulks[0]?.action).toBe('snooze');
  });

  it('returns a body untouched when no chips are present', () => {
    const text = 'A plain teaching paragraph with no chips at all.';
    const result = parseSuperpowers(text);
    expect(result.body).toBe(text);
    expect(result.navigates).toHaveLength(0);
    expect(result.dropped).toBe(0);
  });
});
