/**
 * Payment-diagnosis types + the bilingual (EN/SW) classification catalogue.
 *
 * Mr. Mwikila is the user's first line of technical support. The
 * payment-inspector (./payment-inspector.ts) is a READ-ONLY service that
 * root-causes a user's payment issue against the already-populated diagnosis
 * signals (payment_intents.failure_reason, webhook_events /
 * webhook_dead_letters, journal_idempotency, audit_events category=PAYMENT,
 * the kill-switch state, the gateway-degraded probe) and returns a typed
 * {@link Diagnosis}.
 *
 * HARD RULES honoured (CLAUDE.md):
 *   - Evidence-required: a {@link Diagnosis} NEVER has an empty `evidenceIds`.
 *     The inspector refuses to emit one without proof; the Auditor agent
 *     rejects empty-evidence responses.
 *   - EN/SW absolute toggle: every diagnosis carries BOTH `humanExplanationEn`
 *     and `humanExplanationSw`. The persona / recall surface picks EXACTLY ONE
 *     per active locale — zero mixing, ever.
 *   - Money is READ-ONLY here. Diagnosis touches NO money path; any fix routes
 *     through the existing gated action-executor verbs (LedgerService owns the
 *     money path).
 */

import type { SupportCaseSeverity } from '../support-cases/case-types.js';

/**
 * What the MD should DO next about the issue:
 *   - guide_user     — user-side problem (insufficient balance, wrong PIN);
 *                      explain + guide. No system action.
 *   - auto_safe_fix  — transient / self-healing (webhook retry pending, a
 *                      duplicate already deduped); reassure + watch. The MD may
 *                      offer a SAFE gated re-check verb, never a money write.
 *   - escalate       — systematic / our-side failure (ledger post failed,
 *                      gateway hard-down); open + escalate to a human.
 */
export type SuggestedResolution = 'guide_user' | 'auto_safe_fix' | 'escalate';

/**
 * The machine-classified root-cause codes the inspector recognises. Stable
 * tokens persisted to `support_cases.root_cause`. `no_payment_activity` and
 * `unclassified_failure` are the safe fallbacks.
 */
export type PaymentRootCause =
  | 'insufficient_balance'
  | 'user_cancelled'
  | 'webhook_retry_pending'
  | 'webhook_dead_lettered'
  | 'gateway_degraded'
  | 'ledger_post_failed'
  | 'payment_succeeded'
  | 'unclassified_failure'
  | 'no_payment_activity';

/**
 * One classification recipe: the human EN/SW copy + the operational severity +
 * what to do. The inspector binds a concrete root cause + the evidence ids it
 * found to one of these to build a {@link Diagnosis}.
 */
export interface DiagnosisClassification {
  readonly rootCause: PaymentRootCause;
  readonly severity: SupportCaseSeverity;
  readonly suggestedResolution: SuggestedResolution;
  /** First-line-support explanation, English. */
  readonly humanExplanationEn: string;
  /** First-line-support explanation, Swahili. Strictly single-language. */
  readonly humanExplanationSw: string;
}

/**
 * The typed root-cause diagnosis the inspector returns. `evidenceIds` is
 * NEVER empty for a real diagnosis (evidence-required). `title` is a short
 * human label for the support case.
 */
export interface Diagnosis {
  readonly rootCause: PaymentRootCause;
  readonly title: string;
  readonly humanExplanationEn: string;
  readonly humanExplanationSw: string;
  /** Audit / payment_intent / webhook record ids proving the diagnosis. */
  readonly evidenceIds: ReadonlyArray<string>;
  readonly severity: SupportCaseSeverity;
  readonly suggestedResolution: SuggestedResolution;
}

/**
 * The bilingual classification catalogue. Each entry is a complete EN+SW pair
 * (CLAUDE.md: owner personas / UI copy must have complete EN and SW
 * translations). The inspector NEVER mixes the two — it stores both and the
 * surface renders one per active locale.
 *
 * NOTE: the copy is generic + amount-free here (no hard-coded TZS — CLAUDE.md).
 * When a concrete amount is shown to the user it is rendered separately via
 * `formatCurrency(amount, currencyCode)` from the payment_intent's own
 * `currency` column, never interpolated into these strings.
 */
export const DIAGNOSIS_CATALOGUE: Readonly<
  Record<PaymentRootCause, DiagnosisClassification>
> = Object.freeze({
  insufficient_balance: {
    rootCause: 'insufficient_balance',
    severity: 'low',
    suggestedResolution: 'guide_user',
    humanExplanationEn:
      'Your payment was declined because the mobile-money or card account did not have enough balance to cover it. Top up the account and try the payment again.',
    humanExplanationSw:
      'Malipo yako yalikataliwa kwa sababu akaunti ya simu au kadi haikuwa na salio la kutosha. Ongeza salio kisha jaribu malipo tena.',
  },
  user_cancelled: {
    rootCause: 'user_cancelled',
    severity: 'low',
    suggestedResolution: 'guide_user',
    humanExplanationEn:
      'The payment was cancelled before it completed — the prompt was dismissed or the PIN was not entered in time. Start the payment again and approve the prompt on your phone.',
    humanExplanationSw:
      'Malipo yalighairiwa kabla ya kukamilika — ujumbe ulifungwa au PIN haikuwekwa kwa wakati. Anzisha malipo tena na uthibitishe ujumbe kwenye simu yako.',
  },
  webhook_retry_pending: {
    rootCause: 'webhook_retry_pending',
    severity: 'medium',
    suggestedResolution: 'auto_safe_fix',
    humanExplanationEn:
      'Your money left the provider but our confirmation is still arriving — the provider is retrying delivery. This usually settles by itself within a few minutes; no action is needed and nothing was charged twice.',
    humanExplanationSw:
      'Pesa yako imetoka kwa mtoa huduma lakini uthibitisho wetu bado unawasili — mtoa huduma anajaribu tena kutuma. Mara nyingi hukamilika wenyewe ndani ya dakika chache; hakuna hatua inayohitajika na hujatozwa mara mbili.',
  },
  webhook_dead_lettered: {
    rootCause: 'webhook_dead_lettered',
    severity: 'high',
    suggestedResolution: 'escalate',
    humanExplanationEn:
      'The provider confirmation for your payment failed to reach us after several automatic retries and is now queued for our team to reconcile manually. We have flagged it for review; you do not need to pay again.',
    humanExplanationSw:
      'Uthibitisho wa malipo yako kutoka kwa mtoa huduma haukufika kwetu baada ya majaribio kadhaa na sasa umepangwa timu yetu ipatanishe. Tumeuweka kwa ukaguzi; huhitaji kulipa tena.',
  },
  gateway_degraded: {
    rootCause: 'gateway_degraded',
    severity: 'high',
    suggestedResolution: 'guide_user',
    humanExplanationEn:
      'The payment gateway is currently degraded, so payments may be slow or failing for everyone right now. Please wait a short while and try again; we are watching the gateway recover.',
    humanExplanationSw:
      'Lango la malipo kwa sasa lina hitilafu, hivyo malipo yanaweza kuwa polepole au kushindwa kwa kila mtu sasa hivi. Tafadhali subiri kidogo kisha jaribu tena; tunafuatilia lango lirudi kawaida.',
  },
  ledger_post_failed: {
    rootCause: 'ledger_post_failed',
    severity: 'critical',
    suggestedResolution: 'escalate',
    humanExplanationEn:
      'Your payment was received but our accounting system could not record it correctly. This is on our side — we have escalated it to our team to fix and reconcile your balance. You do not need to pay again.',
    humanExplanationSw:
      'Malipo yako yalipokelewa lakini mfumo wetu wa hesabu haukuweza kuyarekodi sawasawa. Hili ni la upande wetu — tumelipeleka kwa timu yetu kurekebisha na kupatanisha salio lako. Huhitaji kulipa tena.',
  },
  payment_succeeded: {
    rootCause: 'payment_succeeded',
    severity: 'low',
    suggestedResolution: 'guide_user',
    humanExplanationEn:
      'Your most recent payment actually completed successfully and has been recorded. If you still see a problem, it may be a display delay — refresh, and tell me what you expected to see.',
    humanExplanationSw:
      'Malipo yako ya hivi karibuni kwa kweli yalikamilika na yamerekodiwa. Kama bado unaona tatizo, huenda ni ucheleweshaji wa kuonyesha — onyesha upya, na uniambie ulitarajia kuona nini.',
  },
  unclassified_failure: {
    rootCause: 'unclassified_failure',
    severity: 'medium',
    suggestedResolution: 'escalate',
    humanExplanationEn:
      'Your payment failed, but the exact reason is not clear from the records yet. I have opened a case and gathered the evidence; let me escalate it so our team can pin down the cause.',
    humanExplanationSw:
      'Malipo yako yalishindwa, lakini sababu hasa haijawa wazi kwenye kumbukumbu bado. Nimefungua kesi na kukusanya ushahidi; niiache ipelekwe ili timu yetu ibaini sababu.',
  },
  no_payment_activity: {
    rootCause: 'no_payment_activity',
    severity: 'low',
    suggestedResolution: 'guide_user',
    humanExplanationEn:
      'I could not find any recent payment activity on your account in the window I checked. If you just made a payment, give it a moment and ask again, or share the reference so I can look it up.',
    humanExplanationSw:
      'Sikuweza kupata shughuli yoyote ya malipo ya hivi karibuni kwenye akaunti yako katika kipindi nilichoangalia. Kama umelipa hivi punde, subiri kidogo uulize tena, au shiriki kumbukumbu ili niitafute.',
  },
});
