import { describe, it, expect } from 'vitest';
import { toSafeSvg } from '../sanitize-svg';

/**
 * `dynamic_visual` block SVG is LLM-composed (svg-primitives) and therefore
 * untrusted. These tests prove the DOMPurify (SVG profile) wrap strips the
 * common XSS vectors before the markup reaches `dangerouslySetInnerHTML`,
 * satisfying the CLAUDE.md hard rule "No raw HTML interpolation. DOMPurify
 * wraps required." (Runs under the chat-ui jsdom env, so `window` exists and
 * the client sanitisation path executes.)
 */
describe('toSafeSvg', () => {
  it('strips a <script> payload while keeping legitimate SVG shapes', () => {
    const malicious =
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect x="1" y="1" width="8" height="8"/></svg>';
    const safe = toSafeSvg(malicious);
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('alert(1)');
    // legitimate geometry survives
    expect(safe).toContain('rect');
  });

  it('strips an onload= event-handler payload', () => {
    const malicious = '<svg onload="alert(document.cookie)"><circle r="5"/></svg>';
    const safe = toSafeSvg(malicious);
    expect(safe.toLowerCase()).not.toContain('onload');
    expect(safe).not.toContain('alert(document.cookie)');
    expect(safe).toContain('circle');
  });

  it('strips a javascript: href / scripted anchor vector', () => {
    const malicious =
      '<svg><a href="javascript:alert(1)"><text>click</text></a></svg>';
    const safe = toSafeSvg(malicious).toLowerCase();
    expect(safe).not.toContain('javascript:');
  });

  it('strips an <image> with an onerror handler', () => {
    const malicious = '<svg><image href="x" onerror="alert(1)"/></svg>';
    const safe = toSafeSvg(malicious).toLowerCase();
    expect(safe).not.toContain('onerror');
    expect(safe).not.toContain('alert(1)');
  });

  it('passes a clean SVG through intact', () => {
    const clean =
      '<svg viewBox="0 0 100 100"><rect width="100" height="100"/><text x="10" y="20">ok</text></svg>';
    const safe = toSafeSvg(clean);
    expect(safe).toContain('rect');
    expect(safe).toContain('text');
    expect(safe).toContain('ok');
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(toSafeSvg(null)).toBe('');
    expect(toSafeSvg(undefined)).toBe('');
    expect(toSafeSvg('')).toBe('');
  });
});
