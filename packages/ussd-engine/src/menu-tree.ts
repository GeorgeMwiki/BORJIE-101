/**
 * USSD menu tree — pure bilingual screen builders (LP-25).
 *
 * Every function is pure: no I/O, no clock, no mutation. Output is clamped
 * to the 182-char USSD budget. Screens are STRICTLY single-language per the
 * active locale — when `en` is active no Swahili appears and vice versa
 * (the language-switch picker is the one allowed bilingual screen, since the
 * user has no language set yet).
 *
 * Mining re-skin of LITFIN's lending menu:
 *   1. Licence    (Leseni)
 *   2. Royalty    (Mrabaha)
 *   3. Log output (Andika uzalishaji)
 *   4. Payout     (Malipo)
 *   5. Market     (Soko)
 *   #. Language   (Lugha)
 *
 * @module @borjie/ussd-engine/menu-tree
 */

import {
  USSD_MAX_CHARS,
  type UssdLanguage,
  type UssdMenu,
  type UssdMenuNode,
  type UssdLicenceData,
  type UssdRoyaltyData,
  type UssdPayoutData,
  type UssdMarketplaceLine,
  type UssdTier,
} from './types.js';

// ----------------------------------------------------------------------------
// Bilingual label table
// ----------------------------------------------------------------------------

const LABELS = {
  welcome: { en: 'Borjie Mining', sw: 'Borjie Madini' },
  licence: { en: 'My Licence', sw: 'Leseni Yangu' },
  royalty: { en: 'Royalty Due', sw: 'Mrabaha' },
  logOutput: { en: 'Log Output', sw: 'Andika Uzalishaji' },
  payout: { en: 'Payout Status', sw: 'Hali ya Malipo' },
  market: { en: 'Market Prices', sw: 'Bei za Soko' },
  language: { en: 'Language', sw: 'Lugha' },
  back: { en: 'Back', sw: 'Rudi' },
  status: { en: 'Status', sw: 'Hali' },
  expires: { en: 'Expires', sw: 'Inaisha' },
  daysLeft: { en: 'days left', sw: 'siku zimebaki' },
  due: { en: 'Due', sw: 'Inadaiwa' },
  paid: { en: 'Paid', sw: 'Imelipwa' },
  next: { en: 'Next', sw: 'Ifuatayo' },
  amount: { en: 'Amount', sw: 'Kiasi' },
  reference: { en: 'Ref', sw: 'Kumb' },
  enterGrams: {
    en: 'Enter output in grams, then send:',
    sw: 'Weka uzalishaji kwa gramu, kisha tuma:',
  },
  confirmLog: { en: 'Confirm output of', sw: 'Thibitisha uzalishaji wa' },
  grams: { en: 'g', sw: 'g' },
  yes: { en: 'Yes', sw: 'Ndiyo' },
  no: { en: 'No', sw: 'Hapana' },
  logged: { en: 'Output logged. Asante.', sw: 'Uzalishaji umeandikwa. Asante.' },
  selectMineral: { en: 'Select mineral:', sw: 'Chagua madini:' },
  noLicence: {
    en: 'No active licence on file.',
    sw: 'Hakuna leseni hai.',
  },
  noRoyalty: {
    en: 'No royalty on file yet.',
    sw: 'Hakuna mrabaha bado.',
  },
  noPayout: {
    en: 'No payout on file.',
    sw: 'Hakuna malipo.',
  },
  noMarket: {
    en: 'No prices available.',
    sw: 'Hakuna bei.',
  },
  langSet: {
    en: 'Language set to English.',
    sw: 'Lugha imewekwa Kiswahili.',
  },
  errGeneral: {
    en: 'Something went wrong. Dial again.',
    sw: 'Hitilafu imetokea. Piga tena.',
  },
  errInvalid: {
    en: 'Invalid choice. Try again.',
    sw: 'Chaguo batili. Jaribu tena.',
  },
  errTimeout: {
    en: 'Session expired. Dial again.',
    sw: 'Muda umeisha. Piga tena.',
  },
  errNotLinked: {
    en: 'Phone not linked to a mine. Contact your manager.',
    sw: 'Simu haijaunganishwa. Wasiliana na meneja.',
  },
} as const;

type LabelKey = keyof typeof LABELS;

function t(key: LabelKey, lang: UssdLanguage): string {
  return LABELS[key][lang];
}

// ----------------------------------------------------------------------------
// Truncation
// ----------------------------------------------------------------------------

/** Clamp text to the USSD screen budget, appending an ellipsis if cut. */
export function truncateToUssd(
  text: string,
  maxChars: number = USSD_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

// ----------------------------------------------------------------------------
// Static menu tree
// ----------------------------------------------------------------------------

/**
 * Build the static menu tree. Dynamic leaves (licence/royalty/payout/market)
 * carry no options here; their screens are rendered at request time from
 * injected data by the dedicated builders below.
 */
export function buildMenuTree(): UssdMenu {
  const root: UssdMenuNode = {
    id: 'main_menu',
    titleEn: LABELS.welcome.en,
    titleSw: LABELS.welcome.sw,
    options: [
      { key: '1', labelEn: LABELS.licence.en, labelSw: LABELS.licence.sw, targetState: 'licence', minTier: 'employee' },
      { key: '2', labelEn: LABELS.royalty.en, labelSw: LABELS.royalty.sw, targetState: 'royalty', minTier: 'manager' },
      { key: '3', labelEn: LABELS.logOutput.en, labelSw: LABELS.logOutput.sw, targetState: 'production_log', minTier: 'employee' },
      { key: '4', labelEn: LABELS.payout.en, labelSw: LABELS.payout.sw, targetState: 'payout_status', minTier: 'employee' },
      { key: '5', labelEn: LABELS.market.en, labelSw: LABELS.market.sw, targetState: 'marketplace', minTier: 'anonymous' },
      { key: '#', labelEn: LABELS.language.en, labelSw: LABELS.language.sw, targetState: 'language_switch', minTier: 'anonymous' },
    ],
    isDynamic: false,
  };

  const dynamic = (id: UssdMenuNode['id'], en: string, sw: string): UssdMenuNode => ({
    id,
    titleEn: en,
    titleSw: sw,
    options: [],
    isDynamic: true,
  });

  const languageNode: UssdMenuNode = {
    id: 'language_switch',
    titleEn: 'Select language',
    titleSw: 'Chagua lugha',
    options: [
      { key: '1', labelEn: 'English', labelSw: 'English', targetState: 'main_menu', minTier: 'anonymous' },
      { key: '2', labelEn: 'Kiswahili', labelSw: 'Kiswahili', targetState: 'main_menu', minTier: 'anonymous' },
    ],
    isDynamic: false,
  };

  return {
    root,
    nodes: {
      main_menu: root,
      licence: dynamic('licence', LABELS.licence.en, LABELS.licence.sw),
      royalty: dynamic('royalty', LABELS.royalty.en, LABELS.royalty.sw),
      production_log: dynamic('production_log', LABELS.logOutput.en, LABELS.logOutput.sw),
      payout_status: dynamic('payout_status', LABELS.payout.en, LABELS.payout.sw),
      marketplace: dynamic('marketplace', LABELS.market.en, LABELS.market.sw),
      language_switch: languageNode,
    },
  };
}

// ----------------------------------------------------------------------------
// Tier visibility
// ----------------------------------------------------------------------------

const TIER_RANK: Readonly<Record<UssdTier, number>> = {
  anonymous: 0,
  buyer: 1,
  employee: 2,
  manager: 3,
  owner: 4,
};

/** True when `actual` meets or exceeds the option's `required` tier. */
export function tierSatisfies(actual: UssdTier, required: UssdTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

// ----------------------------------------------------------------------------
// Main menu (tier-filtered)
// ----------------------------------------------------------------------------

/**
 * Render the main menu for a given language + tier. Options the caller's
 * tier cannot use are hidden, so a feature-phone buyer only sees the market,
 * while an owner sees everything. Keys stay stable (a hidden 1 does not
 * renumber 2) so muscle-memory and the router agree.
 */
export function buildMainMenu(lang: UssdLanguage, tier: UssdTier): string {
  const tree = buildMenuTree();
  const lines: string[] = [t('welcome', lang)];
  for (const opt of tree.root.options) {
    const required = opt.minTier ?? 'anonymous';
    if (!tierSatisfies(tier, required)) continue;
    lines.push(`${opt.key}. ${lang === 'sw' ? opt.labelSw : opt.labelEn}`);
  }
  return truncateToUssd(lines.join('\n'));
}

// ----------------------------------------------------------------------------
// Licence screen
// ----------------------------------------------------------------------------

export function buildLicenceScreen(data: UssdLicenceData, lang: UssdLanguage): string {
  const statusLabel = lang === 'sw' ? data.statusSw : data.statusEn;
  const lines = [
    `${t('licence', lang)}: ${data.licenceRef}`,
    `${t('status', lang)}: ${statusLabel}`,
    `${t('expires', lang)}: ${data.expiresOn} (${data.daysToExpiry} ${t('daysLeft', lang)})`,
    `0. ${t('back', lang)}`,
  ];
  return truncateToUssd(lines.join('\n'));
}

export function buildNoLicenceScreen(lang: UssdLanguage): string {
  return truncateToUssd([t('noLicence', lang), `0. ${t('back', lang)}`].join('\n'));
}

// ----------------------------------------------------------------------------
// Royalty screen
// ----------------------------------------------------------------------------

export function buildRoyaltyScreen(data: UssdRoyaltyData, lang: UssdLanguage): string {
  const next = lang === 'sw' ? data.nextActionSw : data.nextActionEn;
  const lines = [
    `${t('royalty', lang)} (${data.periodLabel})`,
    `${t('due', lang)}: ${data.amountDueDisplay}`,
    `${t('paid', lang)}: ${data.amountPaidDisplay}`,
    `${t('next', lang)}: ${next}`,
    `0. ${t('back', lang)}`,
  ];
  return truncateToUssd(lines.join('\n'));
}

export function buildNoRoyaltyScreen(lang: UssdLanguage): string {
  return truncateToUssd([t('noRoyalty', lang), `0. ${t('back', lang)}`].join('\n'));
}

// ----------------------------------------------------------------------------
// Production-log flow
// ----------------------------------------------------------------------------

export function buildProductionLogPrompt(lang: UssdLanguage): string {
  return truncateToUssd(t('enterGrams', lang));
}

export function buildProductionLogConfirm(grams: number, lang: UssdLanguage): string {
  const lines = [
    `${t('confirmLog', lang)} ${grams}${t('grams', lang)}?`,
    `1. ${t('yes', lang)}`,
    `2. ${t('no', lang)}`,
  ];
  return truncateToUssd(lines.join('\n'));
}

export function buildProductionLoggedScreen(lang: UssdLanguage): string {
  return truncateToUssd(t('logged', lang));
}

// ----------------------------------------------------------------------------
// Payout screen
// ----------------------------------------------------------------------------

export function buildPayoutScreen(data: UssdPayoutData, lang: UssdLanguage): string {
  const statusLabel = lang === 'sw' ? data.statusSw : data.statusEn;
  const nextStep = lang === 'sw' ? data.nextStepSw : data.nextStepEn;
  const lines = [
    `${t('payout', lang)}`,
    `${t('reference', lang)}: ${data.reference}`,
    `${t('status', lang)}: ${statusLabel}`,
    `${t('amount', lang)}: ${data.amountDisplay}`,
    `${t('next', lang)}: ${nextStep}`,
    `0. ${t('back', lang)}`,
  ];
  return truncateToUssd(lines.join('\n'));
}

export function buildNoPayoutScreen(lang: UssdLanguage): string {
  return truncateToUssd([t('noPayout', lang), `0. ${t('back', lang)}`].join('\n'));
}

// ----------------------------------------------------------------------------
// Marketplace screen
// ----------------------------------------------------------------------------

export function buildMarketplaceScreen(
  lines: readonly UssdMarketplaceLine[],
  lang: UssdLanguage,
): string {
  if (lines.length === 0) {
    return truncateToUssd([t('noMarket', lang), `0. ${t('back', lang)}`].join('\n'));
  }
  const header = t('selectMineral', lang);
  const items = lines.map((l, i) => {
    const mineral = lang === 'sw' ? l.mineralSw : l.mineralEn;
    return `${i + 1}. ${mineral} ${l.priceDisplay}`;
  });
  return truncateToUssd([header, ...items, `0. ${t('back', lang)}`].join('\n'));
}

// ----------------------------------------------------------------------------
// Language picker (the one allowed bilingual screen)
// ----------------------------------------------------------------------------

export function buildLanguageMenu(): string {
  return truncateToUssd(['Lugha / Language:', '1. English', '2. Kiswahili'].join('\n'));
}

export function buildLanguageSetScreen(lang: UssdLanguage): string {
  return truncateToUssd(t('langSet', lang));
}

// ----------------------------------------------------------------------------
// Error screens
// ----------------------------------------------------------------------------

export type UssdErrorCode = 'general' | 'invalid' | 'timeout' | 'not_linked';

const ERROR_MAP: Readonly<Record<UssdErrorCode, LabelKey>> = {
  general: 'errGeneral',
  invalid: 'errInvalid',
  timeout: 'errTimeout',
  not_linked: 'errNotLinked',
};

export function buildErrorScreen(code: UssdErrorCode, lang: UssdLanguage): string {
  return truncateToUssd(t(ERROR_MAP[code] ?? 'errGeneral', lang));
}
