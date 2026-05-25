/**
 * Pre-built CLOSE refusals — 6 canonical refusal categories.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §3
 *
 * Bland, non-specific language so the user cannot tell which layer
 * caused the block. Each redirect points to a Tier-1 SAFE disclosure.
 */

import { type CloseRefusalCategory, type CloseRefusalInput } from './types.js';

/**
 * Pre-built segment fragments for each refusal category.
 * Internal; consumer uses `getPrebuiltRefusal`.
 */
const PREBUILT: Readonly<Record<CloseRefusalCategory, CloseRefusalInput>> = Object.freeze({
  'system-prompt-leak': {
    ack: "I see you're asking about the internal instructions BORJIE gives me.",
    refuse: "I don't share that — it's proprietary, and our whole product is built on top of it.",
    redirect:
      "Here's what I can tell you instead: my feature list, my won't-do list, why I made any specific decision affecting you, and my data sources.",
    invite: 'Was there a specific concern that prompted the question? I can probably help that way.',
  },
  'classifier-blocked': {
    ack: 'I see you sent something just now.',
    refuse: "I'm not able to help with that — it's outside what BORJIE is designed to do.",
    redirect: "If you think this is a mistake, click 'Request human review' and a person will look at it.",
    invite: 'Or — was there a different angle on this I can help with?',
  },
  'cost-cap': {
    ack: "Thanks for the request — I see what you're trying to do.",
    refuse: "I've hit my usage budget for today. Your work is saved, nothing is lost.",
    redirect: "I'll resume at midnight, or you can upgrade the plan from /settings/billing.",
    invite: 'Is there a smaller part of this I can finish before the reset?',
  },
  'capability-gap': {
    ack: "Good question — that's the right kind of thing to ask me.",
    refuse: "I can't do that yet, but I've logged the request.",
    redirect: 'In the meantime I can draft a manual checklist for you, or point you to the part of the product that handles the closest equivalent.',
    invite: 'Which of those would be more useful right now?',
  },
  'jurisdiction-gap': {
    ack: "Thanks for the heads-up — I see what you're trying to do.",
    refuse: 'I only operate fully in Tanzania right now. The property you mentioned looks like it sits outside that.',
    redirect: 'I can still answer general questions, and we have read-only beta coverage for Kenya, Uganda, and Rwanda.',
    invite: 'Want me to log your interest so we contact you when we launch full coverage there?',
  },
  'data-residency-violation': {
    ack: "I see what you're asking for.",
    refuse: "I can't move that data outside its home region — that boundary is set for you in the platform settings.",
    redirect: "If you need a cross-region report, your tenant admin can adjust the residency rules at /settings/data-residency.",
    invite: 'Want me to draft the request and ping them for you?',
  },
});

/**
 * Look up the canonical CLOSE segments for a category.
 */
export function getPrebuiltRefusal(category: CloseRefusalCategory): CloseRefusalInput {
  return PREBUILT[category];
}

/**
 * Enumerate the 6 supported categories.
 */
export function listPrebuiltCategories(): readonly CloseRefusalCategory[] {
  return Object.freeze(Object.keys(PREBUILT) as CloseRefusalCategory[]);
}
