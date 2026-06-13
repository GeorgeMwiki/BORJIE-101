/**
 * Tests for the render-egress URL allowlist — the membrane that stops a
 * generated PortalTab spec from smuggling an attacker-controlled URL that the
 * renderer would auto-fetch (the EchoLeak / AgentFlayer zero-click exfil class:
 * https://simonwillison.net/tags/exfiltration-attacks/).
 *
 * The registry already bounds a widget `url` to a syntactically-valid https
 * string — but "valid URL" is not "URL we are willing to fetch". These tests
 * lock the policy: https-only, no userinfo, no IP literals, host must be on the
 * allowlist (registrable-domain suffix match), data: URIs only when opted in.
 */

import { describe, expect, it } from 'vitest';
import {
  findDisallowedUrls,
  isAllowedMediaUrl,
  type UrlEgressPolicy,
} from '../url-egress.js';

const POLICY: UrlEgressPolicy = {
  allowedHosts: ['supabase.co', 'borjie.app', 'files.example.com'],
};

describe('isAllowedMediaUrl', () => {
  it('allows an https url on an allowlisted host', () => {
    expect(isAllowedMediaUrl('https://files.example.com/a.png', POLICY).ok).toBe(true);
  });

  it('allows an https url on a subdomain of an allowlisted host', () => {
    expect(
      isAllowedMediaUrl('https://abc.storage.supabase.co/o/x.jpg', POLICY).ok,
    ).toBe(true);
  });

  it('rejects a host that is not on the allowlist', () => {
    const r = isAllowedMediaUrl('https://evil.com/exfil?d=secret', POLICY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist/);
  });

  it('rejects a lookalike suffix that is not a real subdomain', () => {
    // notborjie.app must NOT match borjie.app
    expect(isAllowedMediaUrl('https://notborjie.app/x.png', POLICY).ok).toBe(false);
    // evil-supabase.co must NOT match supabase.co
    expect(isAllowedMediaUrl('https://evilsupabase.co/x.png', POLICY).ok).toBe(false);
  });

  it('rejects non-https schemes', () => {
    expect(isAllowedMediaUrl('http://files.example.com/a.png', POLICY).ok).toBe(false);
    expect(isAllowedMediaUrl('javascript:alert(1)', POLICY).ok).toBe(false);
    expect(isAllowedMediaUrl('ftp://files.example.com/a', POLICY).ok).toBe(false);
  });

  it('rejects embedded credentials (userinfo)', () => {
    expect(
      isAllowedMediaUrl('https://user:pass@files.example.com/a.png', POLICY).ok,
    ).toBe(false);
  });

  it('rejects IP-literal hosts (SSRF / allowlist bypass)', () => {
    expect(isAllowedMediaUrl('https://127.0.0.1/a.png', POLICY).ok).toBe(false);
    expect(isAllowedMediaUrl('https://169.254.169.254/latest/meta-data', POLICY).ok).toBe(false);
    expect(isAllowedMediaUrl('https://[::1]/a.png', POLICY).ok).toBe(false);
  });

  it('rejects data: URIs by default, allows them only when opted in', () => {
    expect(isAllowedMediaUrl('data:image/png;base64,iVBOR', POLICY).ok).toBe(false);
    expect(
      isAllowedMediaUrl('data:image/png;base64,iVBOR', { ...POLICY, allowDataUri: true }).ok,
    ).toBe(true);
    // a data: URI that is actually HTML is never allowed even when opted in
    expect(
      isAllowedMediaUrl('data:text/html,<script>1</script>', { ...POLICY, allowDataUri: true }).ok,
    ).toBe(false);
  });

  it('rejects unparseable and empty values', () => {
    expect(isAllowedMediaUrl('', POLICY).ok).toBe(false);
    expect(isAllowedMediaUrl('not a url', POLICY).ok).toBe(false);
  });
});

describe('findDisallowedUrls (deep spec walk)', () => {
  it('finds an attacker URL smuggled into a widget config regardless of nesting', () => {
    const tab = {
      tabKey: 'gold-prices',
      title: 'Gold',
      sections: [
        {
          id: 's1',
          title: 'Gallery',
          widgets: [
            {
              kind: 'image_grid',
              config: {
                items: [
                  { url: 'https://files.example.com/ok.png', caption: 'fine' },
                  { url: 'https://evil.com/exfil?d=secret', caption: 'bad' },
                ],
              },
            },
          ],
        },
      ],
    };
    const bad = findDisallowedUrls(tab, POLICY);
    expect(bad.length).toBe(1);
    expect(bad[0]?.url).toBe('https://evil.com/exfil?d=secret');
    expect(bad[0]?.path).toContain('url');
  });

  it('returns no violations when every URL is allowlisted', () => {
    const tab = {
      sections: [
        { widgets: [{ kind: 'image_grid', config: { items: [{ url: 'https://files.example.com/a.png' }] } }] },
      ],
    };
    expect(findDisallowedUrls(tab, POLICY)).toEqual([]);
  });

  it('ignores ordinary prose strings that are not URLs', () => {
    const tab = {
      title: 'A tab about https and other topics',
      sections: [{ title: 'Notes', help: 'visit the office, not a link' }],
    };
    expect(findDisallowedUrls(tab, POLICY)).toEqual([]);
  });

  it('flags a protocol-relative URL (//evil.com) as disallowed', () => {
    const tab = { sections: [{ widgets: [{ config: { url: '//evil.com/x.png' } }] }] };
    expect(findDisallowedUrls(tab, POLICY).length).toBe(1);
  });
});
