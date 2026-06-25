/**
 * cockpit-sse-events — Stream-B {en, sw} copy for the EXTENDED owner-cockpit
 * SSE event set (safety / bids / payroll / Mr. Mwikila / regulator / task /
 * settlement / licence-renewal).
 *
 * WHY A DEDICATED MODULE
 * The original six-kind toast copy lives in `tail.ts` (`cockpitSse`). Adding
 * the new kinds' strings THERE would collide with the other journey stream's
 * edits to the shared `tail` bundle. A separate per-stream module keeps the
 * two streams conflict-free while staying inside the guard-exempt `i18n/`
 * tree (the locale-purity guard skips it).
 *
 * ZERO-MIX: each leaf is a strict `{ en, sw }` pair resolved by the active
 * locale only. `{token}` placeholders are filled by the cockpit-sse describer
 * (`fill`). A SEVERITY / status token interpolated here is a raw enum value
 * from the gateway — acceptable inside a short live-pulse toast where the
 * surrounding sentence is single-language, matching the existing
 * `riskChanged` / `decisionRecorded` copy convention.
 */

export const cockpitSseEventsStrings = {
  safetyIncident: {
    en: 'Safety incident reported ({severity})',
    sw: 'Tukio la usalama limeripotiwa ({severity})',
  },
  bidPlaced: {
    en: 'New offer placed on your listing',
    sw: 'Zabuni mpya imewekwa kwenye tangazo lako',
  },
  bidAccepted: {
    en: 'Offer accepted — offtake contract created',
    sw: 'Zabuni imekubaliwa — mkataba umeundwa',
  },
  bidRejected: {
    en: 'Offer declined',
    sw: 'Zabuni imekataliwa',
  },
  payrollCommitted: {
    en: 'Payroll committed for {headcount} worker(s)',
    sw: 'Mishahara imethibitishwa kwa wafanyakazi {headcount}',
  },
  mwikilaActed: {
    en: 'Mr. Mwikila acted on your behalf: {summary}',
    sw: 'Bw. Mwikila ametenda kwa niaba yako: {summary}',
  },
  mwikilaProposes: {
    en: 'Mr. Mwikila proposes: {summary}',
    sw: 'Bw. Mwikila anapendekeza: {summary}',
  },
  regulatorRequest: {
    en: 'New regulator request received',
    sw: 'Ombi jipya la mdhibiti limepokelewa',
  },
  taskAssigned: {
    en: 'Task assigned: {title}',
    sw: 'Kazi imetolewa: {title}',
  },
  settlementInitiated: {
    en: 'Settlement initiated',
    sw: 'Malipo yameanzishwa',
  },
  licenceRenewalStatus: {
    en: 'Licence renewal status: {status}',
    sw: 'Hali ya uhuishaji wa leseni: {status}',
  },
  incidentEscalated: {
    en: 'Incident escalated to {level}',
    sw: 'Tukio limepandishwa hadi {level}',
  },
} as const;
