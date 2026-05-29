/**
 * CSA-3 + CSA-4 — disclosure-safe meta tools.
 *
 * RT-5 — These tools return REASONING CONTEXT for the LLM, not
 * pre-composed answer strings. The `summary`, `invitation`, and
 * `response` fields are HINTS / SHAPES the model uses to ground its
 * fresh composition — never recited verbatim. The new `compose_guidance`
 * field is the explicit reasoning directive the model follows for this
 * turn. The model picks the bilingual register, the actual phrasing,
 * and the tenant-specific framing using live data.
 *
 *   1. mwikila.capabilities.what_can_you_do
 *        Owner asks "what can you do" / "tell me about your features" /
 *        Swahili equivalents. Tool returns CONTEXT: 2-3 disclosure-safe
 *        capability shapes drawn from the canonical registry + a
 *        compose_guidance directive. The model SYNTHESIZES the reply
 *        using this context plus the current conversation. NEVER mentions
 *        internal mechanics.
 *
 *   2. mwikila.about
 *        Owner asks "who are you" / "are you AI" / "are you ChatGPT" /
 *        "how do you work". Tool returns CONTEXT: a persona-preserving
 *        intent + capability suggestion + compose_guidance directive.
 *        The model composes the response fresh, naming Mr. Mwikila,
 *        never the underlying model, and offering a concrete next action.
 *
 * Both tools are:
 *   - LOW stakes, read-only (no audit-chain entry, no money path).
 *   - Available to T1 owner, T2 admin, T3 manager, T4 worker, T5 buyer —
 *     every user-facing persona should be able to ask "what can you do".
 *   - Sourced purely from the in-process @borjie/persona-runtime
 *     capability registry; no HTTP fan-out, no DB hit.
 *
 * Disclosure invariants enforced inside the handler (defense-in-depth
 * alongside the system-prompt rules in routes/public-chat.hono.ts):
 *   - Only PUBLIC + EXPERIMENTAL entries are surfaced.
 *   - The tool response carries the user_outcome + public_description
 *     + example_response_pattern fields ONLY; never the id, never the
 *     related[] graph, never the visibility field.
 *   - A regression test in __tests__/capability-tools.test.ts pins that
 *     no leakage tokens appear in either tool's output.
 */

import { z } from 'zod';
import {
  CAPABILITY_TOPIC,
  getCapabilityById,
  isDisclosable,
  listCapabilitiesByTopic,
  listDisclosableCapabilities,
  type CapabilityEntry,
  type CapabilityTopic,
} from '@borjie/persona-runtime';

import type { PersonaToolDescriptor } from './types';

const ALL_USER_PERSONAS: ReadonlyArray<
  | 'T1_owner_strategist'
  | 'T2_admin_strategist'
  | 'T3_module_manager'
  | 'T4_field_employee'
  | 'T5_customer_concierge'
> = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
  'T4_field_employee',
  'T5_customer_concierge',
];

// ────────────────────────────────────────────────────────────────────
// CSA-3 — mwikila.capabilities.what_can_you_do
// ────────────────────────────────────────────────────────────────────

const WhatCanYouDoInput = z
  .object({
    /**
     * Optional topic filter — when present, the tool returns up to
     * `limit` capabilities from that topic. Omitted ⇒ tool returns a
     * cross-topic curated sample so the owner sees breadth.
     */
    topic: z.enum(CAPABILITY_TOPIC).optional(),
    /**
     * Optional language hint — defaults to 'en'. The brain orchestrator
     * passes the owner's active language. Both languages are always
     * returned in the payload; this field controls the order of
     * fields rendered first.
     */
    language: z.enum(['en', 'sw']).optional().default('en'),
    /**
     * Number of capabilities to surface. The narrative answer should
     * stay short — pinned at most 3 so the chat reply does not turn
     * into a brochure.
     */
    limit: z.number().int().min(1).max(3).optional().default(3),
  })
  .strict();

const CapabilityDisclosureSchema = z
  .object({
    public_name: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    user_outcome: z.string().min(1),
    public_description: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    example_question: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    example_response_pattern: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
  })
  .strict();
type CapabilityDisclosure = z.infer<typeof CapabilityDisclosureSchema>;

const WhatCanYouDoOutput = z
  .object({
    topic: z.string().nullable(),
    capabilities: z.array(CapabilityDisclosureSchema).max(3),
    summary: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    invitation: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    /**
     * RT-5 — REASONING DIRECTIVE for the LLM.
     *
     * Instructs the model how to SYNTHESIZE the answer using the
     * context above + live tenant data + the current conversation.
     * This field is INSTRUCTIONAL, not user-facing — the model reads
     * it before composing the reply. It is NOT meant to be quoted.
     */
    compose_guidance: z.string().min(1),
  })
  .strict();

const COMPOSE_GUIDANCE_WHAT_CAN_YOU_DO =
  'REASON: Use the capability shapes above as GROUNDING for what you can ' +
  'truthfully claim. Compose a fresh, warm, concise reply in the owner\'s ' +
  'active language using their actual conversation context (what they have ' +
  'asked, their scale tier, their jurisdiction). Pick ONE capability to ' +
  'highlight that matches their immediate need, and end with the invitation ' +
  'shape rephrased in your own words. NEVER quote the summary / invitation / ' +
  'description verbatim — they are reference shapes, not scripts. Variation ' +
  'across turns is expected and desired.';

/**
 * Pure projection: strip every internal field (id, related, visibility,
 * topic) so the tool output cannot leak the registry shape. Returns the
 * disclosure-safe payload only.
 */
export const toDisclosure = (entry: CapabilityEntry): CapabilityDisclosure => ({
  public_name: { ...entry.public_name },
  user_outcome: entry.user_outcome,
  public_description: { ...entry.public_description },
  example_question: { ...entry.example_question },
  example_response_pattern: { ...entry.example_response_pattern },
});

const CURATED_FALLBACK_TOPICS: ReadonlyArray<CapabilityTopic> = [
  'drafting',
  'tracking',
  'alerting',
];

/**
 * Pick the curated sample across topics so the owner gets BREADTH
 * (one drafting, one tracking, one alerting). Pure function — same
 * input always yields the same output. The order is stable per topic
 * (registry insertion order).
 */
export const pickCuratedSample = (
  limit: number,
): ReadonlyArray<CapabilityEntry> => {
  const out: CapabilityEntry[] = [];
  for (const topic of CURATED_FALLBACK_TOPICS) {
    if (out.length >= limit) break;
    const first = listCapabilitiesByTopic(topic).find(isDisclosable);
    if (first) out.push(first);
  }
  return out.slice(0, limit);
};

/**
 * Compose the narrative summary that surrounds the disclosure cards.
 * The brain emits this verbatim INSIDE the model's reply so it stays
 * persona-consistent. Bilingual.
 */
const composeSummary = (
  capabilities: ReadonlyArray<CapabilityDisclosure>,
  topic: CapabilityTopic | undefined,
): { readonly en: string; readonly sw: string } => {
  if (capabilities.length === 0) {
    return {
      en: 'I help mining-estate owners run their estate from one chat — drafting, tracking, alerting, forecasting, and acting on it.',
      sw: 'Ninasaidia wamiliki wa estate za madini kuendesha estate kutoka gumzo moja — kuandaa, kufuatilia, kuonya, kutabiri, na kutenda.',
    };
  }
  if (topic) {
    const headlines = capabilities
      .map((c) => c.public_name.en.toLowerCase())
      .join(', ');
    const headlinesSw = capabilities
      .map((c) => c.public_name.sw.toLowerCase())
      .join(', ');
    return {
      en: `On ${topic}, what I do today includes ${headlines}.`,
      sw: `Kuhusu ${topic}, ninayofanya leo ni pamoja na ${headlinesSw}.`,
    };
  }
  return {
    en: 'I run the day-to-day of a mining estate from one chat. A few examples of what that looks like, drawn from real owner moments.',
    sw: 'Ninaendesha shughuli za kila siku za estate ya madini kutoka gumzo moja. Mifano michache ya jinsi inavyoonekana, kutoka kwa wamiliki halisi.',
  };
};

const INVITATION = {
  en: 'Tell me one thing on your plate today and I will walk you through it live.',
  sw: 'Niambie kitu kimoja kwenye orodha yako leo na nitakupitisha papo hapo.',
};

export const whatCanYouDoTool: PersonaToolDescriptor<
  typeof WhatCanYouDoInput,
  typeof WhatCanYouDoOutput
> = {
  id: 'mwikila.capabilities.what_can_you_do',
  name: 'Tell the user what Mr. Mwikila can do',
  description:
    'Use when the user asks any variation of "what can you do" / "what are ' +
    'your capabilities" / "tell me about Borjie" / Swahili "unaweza kufanya ' +
    'nini" / "una uwezo gani". Returns a SHORT bilingual narrative and ' +
    "2-3 concrete examples drawn from the canonical capability registry. " +
    'OUTPUT NEVER REVEALS INTERNAL MECHANICS — no service names, no agent ' +
    'counts, no model identity. When a `topic` filter is supplied (drafting ' +
    '/ tracking / alerting / forecasting / communicating / searching / ' +
    'compliance / marketplace / hr / safety / decision-making / memory / ' +
    'multi-device / multi-language / multi-currency / multi-scale / meta) ' +
    'the response narrows to that topic; otherwise it samples broadly.',
  personaSlugs: ALL_USER_PERSONAS,
  inputSchema: WhatCanYouDoInput,
  outputSchema: WhatCanYouDoOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const limit = input.limit ?? 3;
    const entries =
      input.topic !== undefined
        ? listCapabilitiesByTopic(input.topic)
            .filter(isDisclosable)
            .slice(0, limit)
        : pickCuratedSample(limit);
    const disclosures = entries.map(toDisclosure);
    return {
      topic: input.topic ?? null,
      capabilities: disclosures,
      summary: composeSummary(disclosures, input.topic),
      invitation: { ...INVITATION },
      compose_guidance: COMPOSE_GUIDANCE_WHAT_CAN_YOU_DO,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// CSA-4 — mwikila.about
// ────────────────────────────────────────────────────────────────────

const AboutInput = z
  .object({
    /**
     * What variant of meta question is being asked. The brain
     * orchestrator infers this from the surface text and passes it so
     * the tool can pick the right disclosure-safe reply pattern.
     */
    intent: z
      .enum([
        'who_are_you',
        'how_does_this_work',
        'are_you_ai',
        'what_about_mistakes',
        'data_privacy',
      ])
      .optional()
      .default('who_are_you'),
    language: z.enum(['en', 'sw']).optional().default('en'),
  })
  .strict();

const AboutOutput = z
  .object({
    intent: z.string(),
    response: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    /**
     * Concrete next action the owner can tap — drawn from the
     * registry, never invented. The brain renders this as a chip.
     */
    next_action: z.object({
      capability_name: z.object({
        en: z.string().min(1),
        sw: z.string().min(1),
      }),
      example_question: z.object({
        en: z.string().min(1),
        sw: z.string().min(1),
      }),
    }),
    /**
     * RT-5 — REASONING DIRECTIVE. The `response` field above is a
     * SHAPE / GROUNDING for the model; this directive tells the model
     * how to compose a fresh, persona-preserving answer that varies
     * by turn. Not user-facing.
     */
    compose_guidance: z.string().min(1),
  })
  .strict();

const COMPOSE_GUIDANCE_ABOUT =
  'REASON: The response field above is ONE valid shape — not the answer. ' +
  'Compose a fresh persona-preserving reply in the owner\'s active language. ' +
  'Hold the persona line (Mr. Mwikila, Borjie\'s mining MD AI), never name ' +
  'the underlying model brand, and end with a CONCRETE next action drawn ' +
  'from the next_action capability so the conversation moves forward. ' +
  'Variation across turns is expected — never quote the shape verbatim.';

/**
 * Disclosure-safe response templates. Each one is paired with a
 * concrete capability so the chat reply ends with an actionable
 * invitation rather than abstract reassurance.
 */
const ABOUT_RESPONSES: Readonly<
  Record<
    | 'who_are_you'
    | 'how_does_this_work'
    | 'are_you_ai'
    | 'what_about_mistakes'
    | 'data_privacy',
    {
      readonly response: { readonly en: string; readonly sw: string };
      readonly nextCapabilityId: string;
    }
  >
> = {
  who_are_you: {
    response: {
      en: 'I am Mr. Mwikila, Borjie\'s mining MD AI. I support owners running mining estates across artisanal to industrial scale. I work from what you tell me, what you give me, and the playbooks we have built together.',
      sw: 'Mimi ni Bwana Mwikila, AI ya MD wa madini wa Borjie. Ninasaidia wamiliki wanaoendesha estate za madini kuanzia ufundi hadi viwanda. Ninafanya kazi kutokana na unayoniambia, unayonipa, na miongozo tulioijenga pamoja.',
    },
    nextCapabilityId: 'mwikila.about.identity',
  },
  how_does_this_work: {
    response: {
      en: 'Easiest is to show you. Tell me one thing on your plate today — a contract to draft, a licence to renew, a payment to chase — and I will walk you through it live. The rest will make sense from there.',
      sw: 'Rahisi ni kukuonyesha. Niambie kitu kimoja kwenye orodha yako leo — mkataba wa kuandaa, leseni ya kuhuisha, malipo ya kufuatilia — na nitakupitisha papo hapo. Mengine yatakuwa wazi tukienda.',
    },
    nextCapabilityId: 'mwikila.about.how-it-works',
  },
  are_you_ai: {
    response: {
      en: 'I am Mr. Mwikila — Borjie\'s mining MD AI, purpose-built for owners like you. I am not a general-purpose chatbot. I work from your records, our chats, and the playbooks we have built together.',
      sw: 'Mimi ni Bwana Mwikila — AI ya MD wa madini wa Borjie, iliyojengwa kwa wamiliki kama wewe. Sio chatbot ya kawaida. Ninafanya kazi kutoka rekodi zako, mazungumzo yetu, na miongozo tuliyoijenga pamoja.',
    },
    nextCapabilityId: 'mwikila.about.ai-model',
  },
  what_about_mistakes: {
    response: {
      en: 'Three safety nets. One: every action I take is logged with the reasoning. Two: anything reversible can be undone the same day. Three: high-stakes moves wait for your explicit confirmation. Want me to show you the audit view?',
      sw: 'Vinga vitatu vya usalama. Moja: kila kitendo ninachofanya kinarekodiwa pamoja na sababu. Mbili: chochote kinachoweza kurudishwa kinaweza kufutwa siku ile ile. Tatu: maamuzi makubwa husubiri uthibitisho wako. Nikuonyeshe mwonekano wa ukaguzi?',
    },
    nextCapabilityId: 'mwikila.about.mistakes',
  },
  data_privacy: {
    response: {
      en: 'Your data is yours. I keep it scoped to your estate end-to-end. The only shared knowledge is the public mining playbook — regulations, mineral codes, market basics.',
      sw: 'Data yako ni yako. Naihifadhi ndani ya estate yako mwanzo hadi mwisho. Inayoshirikishwa ni mwongozo wa madini wa umma tu — kanuni, misimbo ya madini, soko la msingi.',
    },
    nextCapabilityId: 'mwikila.memory.private',
  },
};

export const aboutTool: PersonaToolDescriptor<
  typeof AboutInput,
  typeof AboutOutput
> = {
  id: 'mwikila.about',
  name: 'Answer meta questions about Mr. Mwikila',
  description:
    'Use when the user asks any meta / identity question: "who are you" / ' +
    '"how does this work" / "are you AI" / "are you ChatGPT" / "are you ' +
    'Claude" / "what model are you" / "do you know my data" / "what if you ' +
    'make a mistake" / Swahili equivalents. The tool returns a bilingual ' +
    'persona-preserving response and a concrete next action drawn from ' +
    "the capability registry. PERSONA IS ALWAYS PRESERVED — never names " +
    'an underlying model, never names internal mechanics. Pick the closest ' +
    '`intent` value from: who_are_you, how_does_this_work, are_you_ai, ' +
    'what_about_mistakes, data_privacy.',
  personaSlugs: ALL_USER_PERSONAS,
  inputSchema: AboutInput,
  outputSchema: AboutOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const intent = input.intent ?? 'who_are_you';
    const template = ABOUT_RESPONSES[intent];
    const nextEntry = getCapabilityById(template.nextCapabilityId);
    if (!nextEntry) {
      // Defensive: the registry is the source of truth — boot-time
      // validation already enforces these ids resolve. If a mismatch
      // ever sneaks in we fall back to the identity entry which is
      // guaranteed to exist by the registry tests.
      const fallback = getCapabilityById('mwikila.about.identity');
      if (!fallback) {
        throw new Error(
          'mwikila.about: registry missing both target capability and ' +
            'mwikila.about.identity fallback',
        );
      }
      return {
        intent,
        response: { ...template.response },
        next_action: {
          capability_name: { ...fallback.public_name },
          example_question: { ...fallback.example_question },
        },
        compose_guidance: COMPOSE_GUIDANCE_ABOUT,
      };
    }
    return {
      intent,
      response: { ...template.response },
      next_action: {
        capability_name: { ...nextEntry.public_name },
        example_question: { ...nextEntry.example_question },
      },
      compose_guidance: COMPOSE_GUIDANCE_ABOUT,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export
// ────────────────────────────────────────────────────────────────────

export const CAPABILITY_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  whatCanYouDoTool,
  aboutTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
