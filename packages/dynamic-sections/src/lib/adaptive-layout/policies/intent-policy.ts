/**
 * Intent policy.
 *
 * The strongest signal we have about what the user wants right now
 * is the intent the kernel (P-10 / P-6) detected from their most
 * recent input. If the user just told the chat assistant "I want to
 * pay rent", the payment section MUST be top of the layout — no
 * matter what they were doing five seconds earlier (recency) or how
 * frustrated they are (frustration) or how novice they are
 * (role-mastery).
 *
 * Intent therefore has the HIGHEST weight (25) of any shipped
 * policy. It is also the policy that uses an explicit allowlist of
 * intent → section-marker mappings, because the consequence of a
 * wrong pin is high — a user with payment intent should never see
 * "Maintenance" pinned ahead of "Payments" just because the kernel
 * confused the two strings.
 *
 * Mapping is many-to-many: a single intent may match multiple
 * sections (e.g. "payment" matches both "tenant.payments.history"
 * and "tenant.payments.new"). The policy pins ALL matches, in base
 * order, with the engine resolving the in-pin ordering by score.
 */

import type {
  LayoutContext,
  LayoutPolicy,
  LayoutPreference,
  SectionId,
} from '../types.js';
import { ABSTAIN } from '../types.js';

/**
 * Intent string → substrings that identify the matching section.
 *
 * Substring match is case-insensitive. The mapping is intentionally
 * narrow — only intents we KNOW we can reliably detect are listed.
 * Anything else is a no-op.
 *
 * Section authors don't opt-in here; the policy reads the section
 * key directly. A new "tenant.payment-plans" section will be picked
 * up automatically by the "payment" intent.
 */
const INTENT_MARKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  payment: Object.freeze(['payment', 'paid', 'pay-rent', 'invoice']),
  payments: Object.freeze(['payment', 'paid', 'pay-rent', 'invoice']),
  rent: Object.freeze(['payment', 'paid', 'pay-rent', 'rent']),
  support: Object.freeze(['support', 'help', 'contact', 'assistance']),
  help: Object.freeze(['support', 'help', 'contact', 'assistance']),
  maintenance: Object.freeze(['maintenance', 'repair', 'work-order', 'workorder']),
  reports: Object.freeze(['report', 'analytics', 'statement']),
  report: Object.freeze(['report', 'analytics', 'statement']),
  compliance: Object.freeze(['compliance', 'filing', 'kra', 'gepg']),
  lease: Object.freeze(['lease', 'agreement', 'contract']),
});

function findMatches(
  baseSections: readonly SectionId[],
  markers: readonly string[],
): readonly SectionId[] {
  return baseSections.filter((id) => {
    const lower = id.toLowerCase();
    return markers.some((m) => lower.includes(m));
  });
}

export const intentPolicy: LayoutPolicy = Object.freeze({
  id: 'intent',
  decide(
    context: LayoutContext,
    baseSections: readonly SectionId[],
  ): LayoutPreference {
    const intent = context.intent;
    if (!intent) return ABSTAIN;

    const markers = INTENT_MARKERS[intent.toLowerCase()];
    if (!markers) return ABSTAIN;

    const pin = findMatches(baseSections, markers);
    if (pin.length === 0) return ABSTAIN;

    return Object.freeze({
      pin,
      hide: Object.freeze([]) as readonly SectionId[],
      boost: Object.freeze({}) as Readonly<Record<SectionId, number>>,
      weight: 25,
      reason: `intent=${intent}-pins-${pin.length}`,
    });
  },
});
