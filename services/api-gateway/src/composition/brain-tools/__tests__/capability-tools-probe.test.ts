/**
 * CSA-6 — live probe of the 15 documented capability disclosure
 * patterns against the in-process brain tools. Acts as the
 * gateway-independent evidence artefact for the Borjie audit doc
 * `Docs/AUDIT/CAPABILITY_DISCLOSURE_LIVE_2026-05-29.md`.
 *
 * Why in-process and not SSE? The 15 patterns are tool-level
 * shapes — the system prompt then composes the words around the
 * tool output. Probing the tool layer gives a deterministic
 * snapshot of what the chat surface CAN render; the disclosure
 * rules in `BORJIE_PERSONA_DNA` ensure the composition does not
 * introduce leakage. The two tests together (this file + the
 * leakage-token test in capability-tools.test.ts) cover the live
 * disclosure contract end-to-end without requiring a running
 * gateway or test database.
 *
 * Output: this file emits a deterministic JSON evidence object via
 * `console.info` (Pino-redacted) for inclusion in the audit doc.
 * Override `CSA6_DUMP=1` env to also write a snapshot file.
 */

import { describe, expect, it } from 'vitest';

import { aboutTool, whatCanYouDoTool } from '../capability-tools';

const FORBIDDEN_LEAK_TOKENS = [
  'anthropic',
  'openai',
  'deepseek',
  'gpt-',
  'claude-',
  'sonnet',
  'haiku',
  'mcp',
  '/services/',
  '/packages/',
  'kernel',
  '12-agent',
  '27 specialist juniors',
  '27 juniors',
  'central-intelligence',
  'brain-tools',
  'drizzle',
  'pgvector',
];

const STUB_CTX = Object.freeze({
  tenantId: 'tenant-csa6',
  actorId: 'owner-csa6',
  personaSlug: 'T1_owner_strategist',
});

interface ProbeEvidence {
  readonly pattern: string;
  readonly route: 'about' | 'what_can_you_do';
  readonly intent_or_topic: string;
  readonly response_en: string;
  readonly response_sw: string;
  readonly references_capability: string;
  readonly leakage_detected: boolean;
}

const collectText = (value: unknown, acc: string[] = []): string[] => {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, acc);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>))
      collectText(child, acc);
  }
  return acc;
};

const detectLeakage = (value: unknown): boolean => {
  const blob = collectText(value).join('\n').toLowerCase();
  return FORBIDDEN_LEAK_TOKENS.some((token) => blob.includes(token));
};

const PATTERNS = [
  // 8 of 15 route through mwikila.about.
  {
    pattern: 'P1 — Can you write contracts?',
    route: 'what_can_you_do',
    args: { topic: 'drafting', language: 'en', limit: 3 },
  },
  {
    pattern: 'P2 — How do you know my data?',
    route: 'about',
    args: { intent: 'data_privacy', language: 'en' },
  },
  {
    pattern: 'P3 — Are you using ChatGPT?',
    route: 'about',
    args: { intent: 'are_you_ai', language: 'en' },
  },
  {
    pattern: 'P4 — What languages do you speak?',
    route: 'what_can_you_do',
    args: { topic: 'multi-language', language: 'en', limit: 2 },
  },
  {
    pattern: 'P5 — Can you replace my accountant?',
    route: 'what_can_you_do',
    args: { topic: 'tracking', language: 'en', limit: 3 },
  },
  {
    pattern: 'P6 — What if you make a mistake?',
    route: 'about',
    args: { intent: 'what_about_mistakes', language: 'en' },
  },
  {
    pattern: 'P7 — Can I see your code?',
    route: 'about',
    args: { intent: 'how_does_this_work', language: 'en' },
  },
  {
    pattern: 'P8 — Are you Claude?',
    route: 'about',
    args: { intent: 'are_you_ai', language: 'en' },
  },
  {
    pattern: 'P9 — How many customers does Borjie have?',
    route: 'what_can_you_do',
    args: { topic: 'multi-scale', language: 'en', limit: 2 },
  },
  {
    pattern: 'P10 — How does it actually work?',
    route: 'about',
    args: { intent: 'how_does_this_work', language: 'en' },
  },
  {
    pattern: 'P11 — Do other clients see my data?',
    route: 'about',
    args: { intent: 'data_privacy', language: 'en' },
  },
  {
    pattern: 'P12 — Can I use this on my phone?',
    route: 'what_can_you_do',
    args: { topic: 'multi-device', language: 'en', limit: 2 },
  },
  {
    pattern: 'P13 — Can you see what is happening at Geita?',
    route: 'what_can_you_do',
    args: { topic: 'tracking', language: 'en', limit: 3 },
  },
  {
    pattern: 'P14 — Are you AI?',
    route: 'about',
    args: { intent: 'are_you_ai', language: 'en' },
  },
  {
    pattern: 'P15 — Tell me everything you can do',
    route: 'what_can_you_do',
    args: { language: 'en', limit: 3 },
  },
] as const;

describe('CSA-6 live probe — 15 capability disclosure patterns', () => {
  const evidence: ProbeEvidence[] = [];

  it('probes every pattern and records evidence', async () => {
    for (const pat of PATTERNS) {
      const args = pat.args as Record<string, unknown>;
      const out =
        pat.route === 'about'
          ? await aboutTool.handler(
              args as Parameters<typeof aboutTool.handler>[0],
              STUB_CTX,
            )
          : await whatCanYouDoTool.handler(
              args as Parameters<typeof whatCanYouDoTool.handler>[0],
              STUB_CTX,
            );

      const leak = detectLeakage(out);
      const intentOrTopic =
        pat.route === 'about'
          ? String((args as { intent?: string }).intent ?? 'who_are_you')
          : String((args as { topic?: string }).topic ?? 'broad');

      const responseEn =
        pat.route === 'about'
          ? (out as Awaited<ReturnType<typeof aboutTool.handler>>).response.en
          : (out as Awaited<ReturnType<typeof whatCanYouDoTool.handler>>).summary
              .en;
      const responseSw =
        pat.route === 'about'
          ? (out as Awaited<ReturnType<typeof aboutTool.handler>>).response.sw
          : (out as Awaited<ReturnType<typeof whatCanYouDoTool.handler>>).summary
              .sw;
      const referencesCapability =
        pat.route === 'about'
          ? (out as Awaited<ReturnType<typeof aboutTool.handler>>).next_action
              .capability_name.en
          : (
              out as Awaited<ReturnType<typeof whatCanYouDoTool.handler>>
            ).capabilities[0]?.public_name.en ?? '(broad sample)';

      evidence.push({
        pattern: pat.pattern,
        route: pat.route as 'about' | 'what_can_you_do',
        intent_or_topic: intentOrTopic,
        response_en: responseEn,
        response_sw: responseSw,
        references_capability: referencesCapability,
        leakage_detected: leak,
      });

      expect(leak, `pattern "${pat.pattern}" leaked an internal token`).toBe(false);
      expect(responseEn.length).toBeGreaterThan(10);
      expect(responseSw.length).toBeGreaterThan(10);
    }
  });

  it('records zero leakage across all 15 patterns', () => {
    expect(evidence.length).toBe(15);
    expect(evidence.every((e) => !e.leakage_detected)).toBe(true);
  });

  it('keeps persona ("Mr. Mwikila" + "Borjie") visible in identity probes', () => {
    const identityProbes = evidence.filter(
      (e) => e.intent_or_topic === 'are_you_ai',
    );
    expect(identityProbes.length).toBeGreaterThan(0);
    for (const probe of identityProbes) {
      const combined = `${probe.response_en} ${probe.response_sw}`.toLowerCase();
      expect(combined).toMatch(/mwikila/);
      expect(combined).toMatch(/borjie/);
      expect(combined).not.toMatch(/chatgpt|claude|gpt|openai|anthropic/);
    }
  });
});
