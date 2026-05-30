"use client";

import { useContext } from "react";
import { LanguageContext, type LanguageContextValue } from "./LanguageContext";

/**
 * Hook to access the Borjie i18n system.
 *
 * @returns { t, language, setLanguage, translateText, td }
 *
 * Ported verbatim from sibling-port src/core/i18n/useTranslation.ts.
 */
export function useTranslation(): LanguageContextValue {
  return useContext(LanguageContext);
}
