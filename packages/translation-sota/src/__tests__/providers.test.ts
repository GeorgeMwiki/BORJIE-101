/**
 * Provider port tests.
 *
 * Covers:
 *   - Claude prompt construction includes the placeholder-preservation
 *     directive.
 *   - Gemini prompt construction emits a `systemInstruction` parts
 *     array.
 *   - NLLB language-code mapping (`sw` → `swh_Latn`, `en` →
 *     `eng_Latn`).
 *   - Claude fetcher is invoked exactly once with the configured
 *     headers + body.
 */

import { describe, expect, it } from 'vitest';
import {
  buildClaudePrompt,
  createClaudeProvider,
} from '../providers/claude-mt.js';
import { buildGeminiPrompt } from '../providers/gemini-mt.js';
import { nllbLangCode } from '../providers/nllb-mt.js';
import type { ProviderTranslateRequest } from '../types.js';

const SAMPLE: ProviderTranslateRequest = Object.freeze({
  sourceLang: 'sw',
  targetLang: 'en',
  sourceText: 'Ndugu, <<G:0001>> imefika kwa <<G:0002>>.',
  placeholders: Object.freeze(['<<G:0001>>', '<<G:0002>>']),
  register: Object.freeze({ level: 'formal', honorific: 'ndugu' }),
});

describe('providers', () => {
  it('Claude prompt embeds the placeholder-preservation directive', () => {
    const prompt = buildClaudePrompt(SAMPLE);
    expect(prompt).toContain('<<G:NNNN>>');
    expect(prompt.toLowerCase()).toContain('verbatim');
    expect(prompt).toContain('<<G:0001>>');
  });

  it('Gemini prompt has both systemInstruction + user parts and honours register', () => {
    const prompt = buildGeminiPrompt(SAMPLE);
    expect(prompt.systemInstruction.toLowerCase()).toContain('placeholder');
    expect(prompt.systemInstruction.toLowerCase()).toContain('formal');
    expect(prompt.user).toBe(SAMPLE.sourceText);
  });

  it('NLLB language codes follow the swh_Latn / eng_Latn convention', () => {
    expect(nllbLangCode('sw')).toBe('swh_Latn');
    expect(nllbLangCode('en')).toBe('eng_Latn');
  });

  it('Claude provider invokes the fetcher exactly once with correct headers', async () => {
    let calls = 0;
    let capturedHeaders: Readonly<Record<string, string>> | null = null;
    let capturedBody: string | null = null;
    const provider = createClaudeProvider({
      config: {
        apiKey: 'test-key',
        model: 'claude-opus-4-7',
        endpoint: 'https://example.invalid/v1/messages',
      },
      fetcher: async (req) => {
        calls += 1;
        capturedHeaders = req.headers;
        capturedBody = req.body;
        return Object.freeze({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () =>
            Object.freeze({
              content: [Object.freeze({ type: 'text', text: 'Hello.' })],
            }),
        });
      },
      now: () => 0,
    });

    const result = await provider.translate(SAMPLE);
    expect(calls).toBe(1);
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders?.['x-api-key']).toBe('test-key');
    expect(capturedBody).toContain('claude-opus-4-7');
    expect(result.targetText).toBe('Hello.');
  });
});
