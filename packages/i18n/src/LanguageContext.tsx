"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Language } from "./languages";

// ─── Constants ──────────────────────────────────────────────────────

const STORAGE_KEY = "borjie-language";
const DEFAULT_LANGUAGE: Language = "sw"; // Borjie Swahili-first hard rule

// ─── Types ──────────────────────────────────────────────────────────

export interface LanguageContextValue {
  /** Current language code */
  readonly language: Language;
  /** Set a new language (persists to localStorage) */
  readonly setLanguage: (lang: Language) => void;
  /** Translate a dot-notation key, e.g. t('nav.dashboard') */
  readonly t: (
    key: string,
    vars?: Readonly<Record<string, string | number>>,
  ) => string;
  /** Translate arbitrary text (not a key) in real-time */
  readonly translateText: (text: string) => string;
  /** Dynamic translate: arbitrary text through NLP cascade */
  readonly td: (text: string) => string;
}

// ─── Context ────────────────────────────────────────────────────────

export const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  // Missing-key behaviour: return empty string. No hardcoded English or
  // humanized fallback anywhere. A missing key is a translation gap that
  // must be filled by adding the real entry. Empty render makes the gap
  // obvious in QA instead of hiding it behind a synthetic label.
  t: () => "",
  translateText: (text: string) => text,
  td: (text: string) => text,
});

// ─── Resolve helper (pure, no mutation) ─────────────────────────────

/**
 * Look up a dot-notation key in the active translation tree. Returns an
 * empty string if the key is missing.
 *
 * Pattern ported from LitFin src/core/i18n/LanguageContext.tsx; Borjie
 * hosts inject their own translation tree (per-app translations live in
 * apps/marketing/src/i18n, apps/workforce-mobile/src/i18n, etc.) so this
 * shared package stays domain-neutral.
 */
function resolveKey(obj: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ? current : "";
}

function interpolate(
  template: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

// ─── Provider ──────────────────────────────────────────────────────

export interface LanguageProviderProps {
  readonly children: ReactNode;
  /** Per-app translation trees keyed by language code. Host supplies. */
  readonly translations: Readonly<Record<Language, Record<string, unknown>>>;
  /** Default language. Defaults to `sw` per Borjie Swahili-first rule. */
  readonly defaultLanguage?: Language;
  /** localStorage key. Defaults to `borjie-language`. */
  readonly storageKey?: string;
}

export function LanguageProvider({
  children,
  translations,
  defaultLanguage = DEFAULT_LANGUAGE,
  storageKey = STORAGE_KEY,
}: LanguageProviderProps): JSX.Element {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);

  // Hydrate from storage once on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && stored in translations) {
        setLanguageState(stored as Language);
      }
    } catch {
      /* private mode / no storage */
    }
  }, [storageKey, translations]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const t = useCallback(
    (key: string, vars?: Readonly<Record<string, string | number>>) => {
      const tree = translations[language];
      if (!tree) return "";
      return interpolate(resolveKey(tree, key), vars);
    },
    [language, translations],
  );

  const translateText = useCallback(
    (text: string) => text, // host wires a real NLP cascade if needed
    [],
  );

  const td = useCallback(
    (text: string) => text, // host wires dynamic translation if needed
    [],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t, translateText, td }),
    [language, setLanguage, t, translateText, td],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
