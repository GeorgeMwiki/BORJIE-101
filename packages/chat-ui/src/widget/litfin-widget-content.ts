/**
 * Widget content registry — carbon copy of LitFin's widget-content.ts,
 * Borjie mining-estate-skinned.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/widget-content.ts
 */

export type WidgetLanguage = 'en' | 'sw';
export type WidgetPortalId =
  | 'public'
  | 'owner'
  | 'estate-manager'
  | 'customer'
  | 'admin';

export interface WidgetSuggestionChip {
  readonly label: string;
  readonly prompt: string;
}

const GENERIC_SWAHILI_CHIPS: ReadonlyArray<WidgetSuggestionChip> = [
  {
    label: 'Mr. Mwikila, Borjie ni nini?',
    prompt:
      'Mr. Mwikila, eleza Borjie ni nini na jinsi inavyowasaidia wamiliki wa migodi kuendesha portfolio yao kwa urahisi.',
  },
  {
    label: 'Ninawezaje kuanza?',
    prompt:
      'Mr. Mwikila, nionyeshe hatua za kuanza kutumia Borjie kwa portfolio yangu ya migodi.',
  },
  {
    label: 'Nisaidie kuelewa ukurasa huu',
    prompt:
      'Mr. Mwikila, nieleze kwa Kiswahili kinachoonekana kwenye ukurasa huu na ninaweza kufanya nini hapa.',
  },
];

const GENERIC_ENGLISH_CHIPS: ReadonlyArray<WidgetSuggestionChip> = [
  {
    label: 'What is Borjie?',
    prompt:
      'Mr. Mwikila, give me the elevator pitch for Borjie and how it helps mining owners run their portfolio.',
  },
  {
    label: 'How do I get started?',
    prompt:
      'Mr. Mwikila, walk me through the first three things I should do to onboard my mining portfolio onto Borjie.',
  },
  {
    label: 'Explain this page',
    prompt:
      'Mr. Mwikila, explain what this page shows and what actions I can take from here.',
  },
];

const MWIKILA_MARKETING_GREETINGS: Readonly<
  Record<string, Readonly<{ en: string; sw: string }>>
> = {
  '/pricing': {
    en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. I can help you find the right plan for your portfolio.",
    sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Naweza kukusaidia kupata mpango unaofaa portfolio yako.',
  },
  '/for-bank': {
    en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. I can show you how Borjie helps banks underwrite, manage, and dispose of distressed mining portfolios.",
    sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Naweza kukuonyesha jinsi Borjie inavyosaidia benki kusimamia migodi.',
  },
  '/for-individual-owner': {
    en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. I can help small mining owners automate royalty, offtakes, and buyer comms.",
    sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Naweza kuwasaidia wamiliki wadogo kuendesha mrabaha na mikataba.',
  },
  '/for-portfolio-owner': {
    en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. I can show you how multi-site owners scale operations without growing headcount.",
    sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Naweza kukuonyesha jinsi wamiliki wa portfolios wanaongeza ukubwa bila kuongeza wafanyakazi.',
  },
  '/for-buyer': {
    en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. I can help buyers pay royalty, request maintenance, and check offtake terms.",
    sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Naweza kuwasaidia wanunuzi kulipa mrabaha na kuomba matengenezo.',
  },
};

const DEFAULT_GREETING: Readonly<Record<WidgetLanguage, string>> = {
  en: "Hi, I'm Mr. Mwikila, Borjie's AI Mining Estate Director. Ask me anything about your portfolio.",
  sw: 'Habari, mimi ni Mr. Mwikila, Mkurugenzi wa Migodi wa AI kutoka Borjie. Niulize chochote kuhusu portfolio yako.',
};

export function getWidgetWelcomeMessage(
  portalId: WidgetPortalId,
  route: string,
  language: WidgetLanguage = 'en',
): string | null {
  if (portalId === 'public') {
    for (const [prefix, greeting] of Object.entries(
      MWIKILA_MARKETING_GREETINGS,
    )) {
      if (route === prefix || route.startsWith(prefix + '/')) {
        return language === 'sw' ? greeting.sw : greeting.en;
      }
    }
  }
  return DEFAULT_GREETING[language];
}

export function getWidgetSuggestionChips(
  _portalId: WidgetPortalId,
  _route: string,
  language: WidgetLanguage = 'en',
): ReadonlyArray<WidgetSuggestionChip> {
  return language === 'sw' ? GENERIC_SWAHILI_CHIPS : GENERIC_ENGLISH_CHIPS;
}
