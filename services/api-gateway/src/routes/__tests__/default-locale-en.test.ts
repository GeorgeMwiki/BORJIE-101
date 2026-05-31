/**
 * Default-locale guard tests.
 *
 * Per the CLAUDE.md hard-rule "English default · bilingual sw/en"
 * (commit 951fd0e5, 2026-05-31): when no `language` field is supplied
 * by the caller, every render path must default to English. These
 * tests are the tripwire — they fail BEFORE the build ships if a
 * future edit silently flips a default back to `sw`.
 *
 * Pure-string + schema assertions only — no provider call, no live
 * model, no I/O.
 */

import { describe, expect, it } from 'vitest';

import { ChatTurnSchema } from '../mining/_openapi/chat-schemas.js';

describe('default-locale en — chat / draft / doc-intelligence schemas', () => {
  it('ChatTurnSchema defaults `language` to `en` when omitted', () => {
    const parsed = ChatTurnSchema.parse({ message: 'hello' });
    expect(parsed.language).toBe('en');
  });

  it('ChatTurnSchema accepts an explicit `sw` selection', () => {
    const parsed = ChatTurnSchema.parse({
      message: 'habari',
      language: 'sw',
    });
    expect(parsed.language).toBe('sw');
  });

  it('ChatTurnSchema rejects unknown languages', () => {
    // Cast through `unknown` so we can feed zod a value our types reject
    // — zod's validation is the unit under test here.
    const unsafeInput: unknown = { message: 'bonjour', language: 'fr' };
    const result = ChatTurnSchema.safeParse(unsafeInput);
    expect(result.success).toBe(false);
  });
});
