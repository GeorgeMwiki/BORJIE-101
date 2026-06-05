/**
 * Gap-12 — mwikila.training.set_chat_mode
 *
 * Ported from LitFin's `set-chat-mode` action tool. Gives Mr. Mwikila an
 * EXPLICIT lever to transition the pedagogical chat surface between modes
 * during an estate-manager / coworker training session. Borjie just mounted
 * the `@borjie/chat-ui` chat-modes capability onto the owner-web
 * HomeChatTeach surface (gap-18, see apps/owner-web/src/components/home-chat/
 * use-chat-mode.ts) — that surface detects modes content-driven from the
 * reply text, but content detection alone is fuzzy. This tool lets the brain
 * SIGNAL the intended mode directly so the layout transforms deterministically
 * (e.g. drop into a quiz lockdown, open a discussion floor, surface a review
 * summary) without page navigation.
 *
 * Design rules (mirrors reason-strategize-tool.ts):
 *   - LOW stakes, READ-ONLY. No money path. No DB write, no audit-chain entry.
 *     The tool returns a DIRECTIVE the chat surface acts on; it mutates no
 *     server state.
 *   - Scoped to the TRAINING / TEACHING context — the personas that run a
 *     training session: T1 owner-strategist, T2 admin-strategist,
 *     T3 module-manager. Field employee / customer / auditor / vendor kept out.
 *   - Mode is validated against the canonical ChatMode union from
 *     @borjie/chat-ui (conversation | teaching | quiz | discussion | review |
 *     classroom). An unknown mode is refused by the zod input schema before the
 *     handler runs (INVALID_PARAMS).
 *   - Honest-degrade (CLAUDE.md): the tool NEVER fabricates a transition it
 *     cannot describe — it echoes back exactly the requested mode and a
 *     bilingual EN+SW directive the surface renders. No hidden side effects.
 *
 * The tool is the SIGNAL; the chat surface (`useChatMode`) is the reducer that
 * applies it. The model still composes the actual lesson / question / summary
 * text itself.
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';

/**
 * Canonical pedagogical chat modes — kept in lockstep with the `ChatMode`
 * union exported by `@borjie/chat-ui` (chat-modes/types.ts). Declared as a
 * local literal tuple (not imported) so the api-gateway brain-tools layer keeps
 * no runtime dependency on the chat-ui FE package; a value drift is caught by
 * the descriptor test.
 */
const CHAT_MODES = [
  'conversation',
  'teaching',
  'quiz',
  'discussion',
  'review',
  'classroom',
] as const;
type ChatModeValue = (typeof CHAT_MODES)[number];

const SetChatModeInput = z
  .object({
    /**
     * The mode the chat surface should transition into. Validated against the
     * canonical ChatMode union — anything else is refused before the handler.
     */
    mode: z.enum(CHAT_MODES),
    /**
     * Optional short rationale for the transition, in the trainer's own words
     * (e.g. "moving to a quick check", "opening the floor for questions").
     * Surfaced in the transition history for auditability.
     */
    reason: z.string().min(1).max(280).optional(),
  })
  .strict();

const SetChatModeOutput = z
  .object({
    /** Stable action discriminator the chat surface switches on. */
    action: z.literal('set-chat-mode'),
    /** The validated target mode. */
    mode: z.enum(CHAT_MODES),
    /** Echoed rationale (always a string — never undefined). */
    reason: z.string().min(1),
    /** Bilingual directive the surface may render while transitioning. */
    message: z.object({
      en: z.string().min(1),
      sw: z.string().min(1),
    }),
    /**
     * Whether this mode locks the surface (quiz lockdown). The host reducer
     * uses this to disable free-text input until the question is answered.
     */
    locks_surface: z.boolean(),
  })
  .strict();

const ALLOWED_PERSONAS = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
] as const;

/** Bilingual EN+SW transition copy per mode. Complete for every ChatMode. */
const MODE_MESSAGES: Record<ChatModeValue, { en: string; sw: string }> = {
  conversation: {
    en: 'Back to open conversation.',
    sw: 'Tunarudi kwenye mazungumzo ya kawaida.',
  },
  teaching: {
    en: 'Switching to teaching mode — walking through the concept.',
    sw: 'Tunaingia hali ya kufundisha — tunapitia dhana hatua kwa hatua.',
  },
  quiz: {
    en: 'Starting a quick check — answer to continue.',
    sw: 'Tunaanza jaribio fupi — jibu ili kuendelea.',
  },
  discussion: {
    en: 'Opening the floor for discussion.',
    sw: 'Tunafungua nafasi ya majadiliano.',
  },
  review: {
    en: 'Reviewing what we covered and where you stand.',
    sw: 'Tunapitia tuliyojifunza na hatua uliyofikia.',
  },
  classroom: {
    en: 'Entering classroom mode for the cohort session.',
    sw: 'Tunaingia hali ya darasa kwa kipindi cha kikundi.',
  },
};

export const setChatModeTool: PersonaToolDescriptor<
  typeof SetChatModeInput,
  typeof SetChatModeOutput
> = {
  id: 'mwikila.training.set_chat_mode',
  name: 'Switch the training chat mode',
  description:
    'Use DURING an estate-manager / coworker training session to transition ' +
    'the pedagogical chat surface into a specific mode so the layout ' +
    'transforms without page navigation. Modes: conversation (open chat), ' +
    'teaching (concept walkthrough), quiz (lockdown check — call this right ' +
    'before you pose an A/B/C/D question), discussion (open floor), review ' +
    '(mastery summary after a block), classroom (cohort session). Call this ' +
    'when YOU decide the session should change shape — e.g. the learner is ' +
    'ready for a check (quiz), has finished a block (review), or wants to ' +
    'talk it through (discussion). Swahili intent works too ("anza jaribio" ' +
    '= start a quiz, "tujadili" = let us discuss). Returns a directive the ' +
    'chat surface applies; you still compose the actual lesson / question / ' +
    'summary text yourself.',
  personaSlugs: ALLOWED_PERSONAS,
  inputSchema: SetChatModeInput,
  outputSchema: SetChatModeOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const mode: ChatModeValue = input.mode;
    return {
      action: 'set-chat-mode' as const,
      mode,
      reason: input.reason ?? 'AI requested mode change',
      message: MODE_MESSAGES[mode],
      locks_surface: mode === 'quiz',
    };
  },
};

export const SET_CHAT_MODE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  setChatModeTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
