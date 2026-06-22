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
  requestFourEye: {
    en: 'Request four-eye approval',
    sw: 'Omba idhini ya macho-mawili',
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
    sw: `Kiasi cha ${threshold} au zaidi kinahitaji idhini ya macho-mawili. Tumia "Uliza Mr. Mwikila" kuomba.`,
  }),
  errorSignFailed: {
    en: 'Sign failed. Please try again.',
    sw: 'Kusaini kumeshindwa. Tafadhali jaribu tena.',
  },
} as const;
