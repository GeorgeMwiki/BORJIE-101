/**
 * Bilingual copy for the OAuth four-eye approve panel
 * (app/oauth/actions/approve/approve-panel.tsx). Lives under src/i18n/strings/
 * — the home the locale-purity guard exempts — so no Swahili literal sits in a
 * component (KEEP the allowlist at []). Every entry carries BOTH en + sw;
 * rendered single-language per active locale via pickByLocale. Zero
 * cross-language fallback.
 */
export const oauthApproveStrings = {
  eyebrow: { en: 'FOUR-EYE APPROVAL', sw: 'IDHINI YA MACHO-MAWILI' },
  header: {
    en: 'Approve a high-risk action',
    sw: 'Idhinisha kitendo cha hatari kubwa',
  },
  missingId: {
    en: 'This approval link is missing its action id.',
    sw: 'Kiungo hiki cha idhini hakina kitambulisho cha kitendo.',
  },
  body: {
    en: 'An external agent requested a sovereign action that requires your explicit approval before it runs.',
    sw: 'Wakala wa nje ameomba kitendo cha ngazi ya juu kinachohitaji idhini yako kabla ya kutekelezwa.',
  },
  idLabel: { en: 'Action id', sw: 'Kitambulisho cha kitendo' },
  approve: { en: 'Approve', sw: 'Idhinisha' },
  deny: { en: 'Deny', sw: 'Kataa' },
  approvedTitle: { en: 'Action approved', sw: 'Kitendo kimeidhinishwa' },
  approvedBody: {
    en: 'The agent can now execute this action once.',
    sw: 'Wakala sasa anaweza kutekeleza kitendo hiki mara moja.',
  },
  deniedTitle: { en: 'Action denied', sw: 'Kitendo kimekataliwa' },
  deniedBody: {
    en: 'This action is locked and cannot run.',
    sw: 'Kitendo hiki kimefungwa na hakiwezi kutekelezwa.',
  },
  expired: {
    en: 'This approval has expired. Ask the agent to request it again.',
    sw: 'Idhini hii imekwisha muda. Mwombe wakala aiombe tena.',
  },
  forbidden: {
    en: 'You are not authorized to approve this action.',
    sw: 'Hauna ruhusa ya kuidhinisha kitendo hiki.',
  },
  problem: {
    en: 'We could not complete that request. Please try again.',
    sw: 'Hatukuweza kukamilisha ombi hilo. Tafadhali jaribu tena.',
  },
} as const;
