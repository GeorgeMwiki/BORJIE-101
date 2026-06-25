/**
 * marketplace-seller — Stream-B journey {en, sw} string module for the
 * owner cockpit SELLER leg: the incoming-bids inbox (Accept / Reject) and
 * the binding offtake-agreement ledger.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard skips the entire `i18n/` tree, so the Swahili
 * literals these surfaces need live here rather than inline in the
 * components. A DEDICATED per-stream module (separate from the other
 * stream's strings file) keeps the two journey streams from colliding on
 * one bundle. Each leaf is a strict `{ en, sw }` pair the call site resolves
 * with `pickByLocale(locale, …)` so exactly ONE language paints — never an
 * EN label under an SW header.
 *
 * Bid + contract STATUS tokens are runtime enum values from the gateway
 * (`pending` | `accepted` | … | `pending_signature` | `signed`). Rendering
 * the raw token to an owner is a zero-mix leak under `sw`, so every token has
 * a localized label here.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`.
 */

export const marketplaceSellerStrings = {
  // ── Incoming-bids inbox ────────────────────────────────────────────
  bidsTitle: { en: 'Incoming offers', sw: 'Zabuni zinazoingia' },
  bidsSubtitle: {
    en: 'Bids buyers placed on your listings',
    sw: 'Zabuni walizoweka wanunuzi kwenye matangazo yako',
  },
  bidsLoadError: {
    en: 'Could not load incoming offers. Try again shortly.',
    sw: 'Imeshindwa kupakia zabuni zinazoingia. Jaribu tena baadaye.',
  },
  bidsEmptyTitle: { en: 'No incoming offers yet', sw: 'Hakuna zabuni bado' },
  bidsEmptyBody: {
    en: 'When a buyer bids on one of your listings it appears here for you to accept or decline.',
    sw: 'Mnunuzi akiweka zabuni kwenye tangazo lako itaonekana hapa ili uikubali au uikatae.',
  },
  bidBuyerLabel: { en: 'Buyer', sw: 'Mnunuzi' },
  bidPlacedLabel: { en: 'Placed', sw: 'Iliwekwa' },
  acceptButton: { en: 'Accept', sw: 'Kubali' },
  rejectButton: { en: 'Decline', sw: 'Kataa' },
  acceptingLabel: { en: 'Accepting…', sw: 'Inakubali…' },
  rejectingLabel: { en: 'Declining…', sw: 'Inakataa…' },
  rejectReasonPlaceholder: {
    en: 'Reason for declining (optional)',
    sw: 'Sababu ya kukataa (si lazima)',
  },
  rejectReasonDefault: {
    en: 'Declined by seller.',
    sw: 'Imekataliwa na muuzaji.',
  },
  actionFailed: {
    en: 'That action could not be completed. Try again.',
    sw: 'Kitendo hicho hakikukamilika. Jaribu tena.',
  },

  // Bid status tokens (marketplace_bids.status) → localized labels.
  bidStatusPending: { en: 'Pending', sw: 'Inasubiri' },
  bidStatusAccepted: { en: 'Accepted', sw: 'Imekubaliwa' },
  bidStatusRejected: { en: 'Declined', sw: 'Imekataliwa' },
  bidStatusCountered: { en: 'Countered', sw: 'Imejibiwa' },
  bidStatusWithdrawn: { en: 'Withdrawn', sw: 'Imeondolewa' },

  // ── Offtake-agreement ledger ───────────────────────────────────────
  offtakeTitle: { en: 'Offtake contracts', sw: 'Mikataba ya manunuzi' },
  offtakeSubtitle: {
    en: 'Binding supply contracts crystallized from accepted bids',
    sw: 'Mikataba inayofunga iliyotokana na zabuni zilizokubaliwa',
  },
  offtakeLoadError: {
    en: 'Could not load your offtake contracts. Try again shortly.',
    sw: 'Imeshindwa kupakia mikataba yako ya manunuzi. Jaribu tena baadaye.',
  },
  offtakeEmptyTitle: {
    en: 'No offtake contracts yet',
    sw: 'Hakuna mikataba bado',
  },
  offtakeEmptyBody: {
    en: 'Accepting a buyer’s offer creates a binding offtake contract here, awaiting signature.',
    sw: 'Kukubali zabuni ya mnunuzi hutengeneza mkataba unaofunga hapa, ukisubiri saini.',
  },
  offtakePriceLabel: { en: 'Agreed price', sw: 'Bei iliyokubaliwa' },
  offtakeQuantityLabel: { en: 'Volume', sw: 'Kiasi' },
  offtakeQuantityUnit: { en: 'kg', sw: 'kg' },
  offtakeCreatedLabel: { en: 'Created', sw: 'Iliundwa' },
  offtakePaymentTermsLabel: { en: 'Payment terms', sw: 'Masharti ya malipo' },

  // Offtake status tokens (offtake_agreements.status) → localized labels.
  offtakeStatusPendingSignature: {
    en: 'Awaiting signature',
    sw: 'Inasubiri saini',
  },
  offtakeStatusSigned: { en: 'Signed', sw: 'Imesainiwa' },
  offtakeStatusCancelled: { en: 'Cancelled', sw: 'Imeghairiwa' },
  offtakeStatusCompleted: { en: 'Completed', sw: 'Imekamilika' },

  // ── Sign action (COMPLETION-LAW: advances → signed + enqueues settlement) ─
  offtakeSignButton: { en: 'Sign & settle', sw: 'Saini na lipa' },
  offtakeSigningLabel: { en: 'Signing…', sw: 'Inasaini…' },
  offtakeSignError: {
    en: 'Could not sign this contract. Try again shortly.',
    sw: 'Imeshindwa kusaini mkataba huu. Jaribu tena baadaye.',
  },
} as const;
