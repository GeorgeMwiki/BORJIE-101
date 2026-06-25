/**
 * royalty-sign-page — guard-exempt bilingual (sw / en) copy for the
 * royalty sign-and-pay route (`finance/royalties/sign/page.tsx`) and its
 * `SignRowForm` sub-component, which previously rendered hardcoded
 * English (the split-brain class). Lives under `i18n/` so the
 * locale-purity scanner exempts the Swahili.
 */

export const royaltySignPageStrings = {
  amountLabel: (currency: string) => ({
    en: `Amount (${currency})`,
    sw: `Kiasi (${currency})`,
  }),
  amountPlaceholder: { en: '0', sw: '0' },

  // --- Page chrome (was hardcoded English; moved here to kill the
  // split-brain so the whole surface renders one language per locale). ---
  backToFinance: { en: 'Back to Finance', sw: 'Rudi kwenye Fedha' },
  eyebrow: { en: 'Finance · Royalty', sw: 'Fedha · Mrabaha' },
  pageTitle: { en: 'Batch royalty sign', sw: 'Saini mrabaha kwa wingi' },
  pageIntro: {
    en: 'Review each draft, enter the royalty amount, and sign to file + post the payment via the double-entry ledger.',
    sw: 'Kagua kila rasimu, ingiza kiasi cha mrabaha, na saini ili kuwasilisha + kuweka malipo kupitia leja ya kuingiza-mara-mbili.',
  },
  loadingDrafts: { en: 'Loading drafts…', sw: 'Inapakia rasimu…' },
  loadError: {
    en: 'Could not load royalty drafts from the gateway.',
    sw: 'Imeshindwa kupakia rasimu za mrabaha kutoka lango.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },

  statusSigned: { en: 'Signed', sw: 'Imesainiwa' },
  statusReviewing: { en: 'Reviewing', sw: 'Inakaguliwa' },
  statusDraft: { en: 'Draft', sw: 'Rasimu' },

  emptyTitle: { en: 'No royalty drafts pending', sw: 'Hakuna rasimu za mrabaha zinazosubiri' },
  emptyBody: {
    en: 'New drafts appear here when Mr. Mwikila prepares the monthly royalty return.',
    sw: 'Rasimu mpya zinaonekana hapa Bw. Mwikila anapoandaa marejesho ya mrabaha ya mwezi.',
  },
  emptyCta: {
    en: 'Ask Mr. Mwikila to prepare a draft',
    sw: 'Mwombe Bw. Mwikila aandae rasimu',
  },

  pendingSignature: (n: number) => ({
    en: `Pending signature (${n})`,
    sw: `Inasubiri saini (${n})`,
  }),
  alreadySigned: (n: number) => ({
    en: `Already signed (${n})`,
    sw: `Tayari zimesainiwa (${n})`,
  }),
  requestFourEye: {
    en: 'Request four-eye approval',
    sw: 'Omba idhini ya macho-mawili',
  },
  // --- Four-eye second-signatory completion affordance. A high-stakes sign
  // cannot be self-approved: a SECOND operator must approve the request, and
  // the owner then enters that approval id to complete the filing. The
  // gateway re-verifies the id is 'approved' before it moves any money. ---
  fourEyeTitle: {
    en: 'Second signatory required',
    sw: 'Mthibitishaji wa pili anahitajika',
  },
  fourEyeExplain: (threshold: string) => ({
    en: `This amount is at or above ${threshold}, so a second operator must approve the filing before it is signed and paid. Request approval, then enter the approval reference below to complete the sign.`,
    sw: `Kiasi hiki ni ${threshold} au zaidi, kwa hivyo opereta wa pili lazima aidhinishe uwasilishaji kabla haujasainiwa na kulipwa. Omba idhini, kisha ingiza kumbukumbu ya idhini hapa chini ili kukamilisha saini.`,
  }),
  fourEyeApprovalLabel: {
    en: 'Approval reference',
    sw: 'Kumbukumbu ya idhini',
  },
  fourEyeApprovalPlaceholder: {
    en: 'Paste the approved request id',
    sw: 'Bandika kitambulisho cha ombi lililoidhinishwa',
  },
  fourEyeApprovalHint: {
    en: 'Provided once a second operator approves your request.',
    sw: 'Inatolewa baada ya opereta wa pili kuidhinisha ombi lako.',
  },
  fourEyePending: {
    en: 'Awaiting a second operator’s approval. The filing completes once you have the approval reference.',
    sw: 'Inasubiri idhini ya opereta wa pili. Uwasilishaji unakamilika ukishapata kumbukumbu ya idhini.',
  },
  signAndPay: { en: 'Sign & pay', sw: 'Saini & lipa' },
  confirmSignAndPay: { en: 'Confirm sign & pay', sw: 'Thibitisha saini & lipa' },
  submitted: { en: 'Submitted', sw: 'Imewasilishwa' },
  signedPosted: {
    en: 'Signed and posted to ledger.',
    sw: 'Imesainiwa na imewekwa kwenye leja.',
  },
  errorEnterValid: {
    en: 'Enter a valid royalty amount before signing.',
    sw: 'Ingiza kiasi sahihi cha mrabaha kabla ya kusaini.',
  },
  errorFourEye: (threshold: string) => ({
    en: `Amounts at or above ${threshold} require a four-eye approval. Use "Ask Mr. Mwikila" to request one.`,
    sw: `Kiasi cha ${threshold} au zaidi kinahitaji idhini ya macho-mawili. Tumia "Uliza Bw. Mwikila" kuomba.`,
  }),
  errorSignFailed: {
    en: 'Sign failed. Please try again.',
    sw: 'Kusaini kumeshindwa. Tafadhali jaribu tena.',
  },
} as const;
