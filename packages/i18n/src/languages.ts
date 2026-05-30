/**
 * Borjie i18n — language registry (subset of sibling-port's 17-lang set, focused on
 * Borjie's pan-African artisanal-to-mid-tier mining audience).
 *
 * Borjie hard rule: Swahili-first. Default user language is `sw`. Owner
 * personas, junior prompts, and UI copy must be bilingual sw/en. Beyond the
 * core SW/EN pair, French + Portuguese cover francophone West/Central Africa
 * and lusophone Mozambique/Angola for buyer-side off-take expansion.
 *
 * Pattern ported from sibling-port src/core/i18n/languages.ts.
 */

export type Language = "sw" | "en" | "fr" | "pt";

export type RegisterLevel = "T" | "V" | "neutral";

export interface LanguageConfig {
  readonly code: Language;
  readonly name: string;
  readonly nativeName: string;
  readonly rtl: boolean;
  readonly voiceSupported: boolean;
  readonly fullTranslation: boolean;
  readonly defaultRegister: RegisterLevel;
}

const REGISTRY: Readonly<Record<Language, LanguageConfig>> = Object.freeze({
  sw: {
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    rtl: false,
    voiceSupported: true,
    fullTranslation: true,
    defaultRegister: "V",
  },
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    rtl: false,
    voiceSupported: true,
    fullTranslation: true,
    defaultRegister: "neutral",
  },
  fr: {
    code: "fr",
    name: "French",
    nativeName: "Français",
    rtl: false,
    voiceSupported: true,
    fullTranslation: false,
    defaultRegister: "V",
  },
  pt: {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    rtl: false,
    voiceSupported: true,
    fullTranslation: false,
    defaultRegister: "V",
  },
});

export const SUPPORTED_LANGUAGES: ReadonlyArray<Language> = Object.freeze([
  "sw",
  "en",
  "fr",
  "pt",
]);

export const RTL_LANGUAGES: ReadonlySet<Language> = new Set([]);

export const VOICE_SUPPORTED_LANGUAGES: ReadonlySet<Language> = new Set([
  "sw",
  "en",
  "fr",
  "pt",
]);

export const FULL_TRANSLATION_LANGUAGES: ReadonlySet<Language> = new Set([
  "sw",
  "en",
]);

export const LANGUAGE_REGISTRY = REGISTRY;

export function getLanguageConfig(code: Language): LanguageConfig {
  return REGISTRY[code];
}

export function getSupportedLanguages(): ReadonlyArray<LanguageConfig> {
  return SUPPORTED_LANGUAGES.map((c) => REGISTRY[c]);
}

export function isRTL(code: Language): boolean {
  return RTL_LANGUAGES.has(code);
}

export function getDefaultRegister(code: Language): RegisterLevel {
  return REGISTRY[code].defaultRegister;
}
