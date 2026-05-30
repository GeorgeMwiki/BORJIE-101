/**
 * @borjie/i18n — Public API
 *
 * Shared i18n shell ported from sibling-port src/core/i18n. The kernel pattern
 * is identical (LanguageProvider context, useTranslation hook, serverT
 * helper) but the translation trees are HOST-SUPPLIED: Borjie's per-app
 * dictionaries (apps/marketing/src/i18n, apps/workforce-mobile/src/i18n,
 * apps/buyer-mobile/src/i18n, apps/owner-web, apps/admin-web) inject
 * their own keys.
 *
 * Borjie Swahili-first hard rule: default language is `sw`, falls back to
 * empty string when a key is missing (NEVER an English fallback — that
 * silently hides translation gaps from QA).
 */

export { LanguageProvider, LanguageContext } from "./LanguageContext";
export type {
  LanguageContextValue,
  LanguageProviderProps,
} from "./LanguageContext";

export { useTranslation } from "./useTranslation";

export { serverT, serverTOrNull } from "./server-t";
export type { ServerTranslations } from "./server-t";

export {
  getLanguageConfig,
  getSupportedLanguages,
  isRTL,
  getDefaultRegister,
  SUPPORTED_LANGUAGES,
  RTL_LANGUAGES,
  VOICE_SUPPORTED_LANGUAGES,
  FULL_TRANSLATION_LANGUAGES,
  LANGUAGE_REGISTRY,
} from "./languages";

export type { Language, LanguageConfig, RegisterLevel } from "./languages";
