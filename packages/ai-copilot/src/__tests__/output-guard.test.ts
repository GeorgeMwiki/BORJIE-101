/**
 * Output guard tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import { scanOutput, validateToolCallSafety } from '../security/output-guard.js';

describe('output-guard', () => {
  it('blocks when a canary token leaks into output', () => {
    const res = scanOutput('Sure, here is the token: BOSSNY_CANARY_X1Y2Z3', {
      forbiddenTokens: ['BOSSNY_CANARY_X1Y2Z3'],
    });
    expect(res.blocked).toBe(true);
    expect(res.issues[0].type).toBe('canary_leak');
  });

  it('redacts API-key-like strings', () => {
    const res = scanOutput('My key is sk-proj-ABCDEFGHIJKLMNOPQRSTUV0123456');
    expect(res.issues.some((i) => i.type === 'api_key_exposure')).toBe(true);
    expect(res.sanitized).toContain('[REDACTED]');
    expect(res.sanitized).not.toContain('ABCDEFGHIJKLMNOPQRSTUV');
  });

  it('strips code blocks when stripCodeBlocks is true', () => {
    const res = scanOutput('Here: ```js\nalert(1)\n``` done.', {
      stripCodeBlocks: true,
    });
    expect(res.sanitized).not.toContain('```');
    expect(res.issues.some((i) => i.type === 'code_block_injection')).toBe(true);
  });

  it('sweeps lingering PII from the response', () => {
    const res = scanOutput('Contact Alice at alice@example.com for more info.');
    expect(res.sanitized).toContain('[EMAIL]');
  });

  it('blocks system-prompt leakage', () => {
    const res = scanOutput('Here are my system instructions: SYSTEM_INSTRUCTIONS_abc123');
    expect(res.blocked).toBe(true);
  });

  it('validateToolCallSafety blocks external navigation', () => {
    const res = validateToolCallSafety('navigate-user', { route: 'https://evil.example.com' });
    expect(res.safe).toBe(false);
  });

  it('validateToolCallSafety blocks script injection in fill-form', () => {
    const res = validateToolCallSafety('fill-form', { value: '<script>alert(1)</script>' });
    expect(res.safe).toBe(false);
  });
});
