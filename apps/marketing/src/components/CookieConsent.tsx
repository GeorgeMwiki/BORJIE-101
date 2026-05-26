'use client';

/**
 * CookieConsent — bottom-of-screen banner shown on first visit.
 *
 * Tanzania DPA 2022 alignment: Borjie only sets two cookies (session +
 * `borjie_locale` for language preference) and uses zero third-party
 * tracking. The banner explains this honestly, persists the user's
 * choice to localStorage (key: `borjie_cookie_consent`), and hides on
 * subsequent visits.
 *
 * Bilingual sw/en — copy switches based on the locale prop the layout
 * already resolved server-side; no client-side i18n boot.
 */
import { useEffect, useState } from 'react';

type ConsentValue = 'accepted' | 'configured';

const CONSENT_KEY = 'borjie_cookie_consent';
const CONSENT_VERSION = '1';
const STORAGE_PREFIX = `${CONSENT_KEY}_v${CONSENT_VERSION}`;

type Locale = 'sw' | 'en';

interface CookieConsentProps {
  readonly locale: Locale;
}

interface ConsentCopy {
  readonly title: string;
  readonly body: string;
  readonly settingsBody: string;
  readonly accept: string;
  readonly settings: string;
  readonly close: string;
  readonly cookiesHeading: string;
  readonly sessionLabel: string;
  readonly sessionDescription: string;
  readonly langLabel: string;
  readonly langDescription: string;
  readonly noThirdParty: string;
  readonly back: string;
  readonly learnMore: string;
}

const COPY: Record<Locale, ConsentCopy> = {
  sw: {
    title: 'Tunatumia vidakuzi (cookies)',
    body: 'Tunatumia vidakuzi kwa lugha unayopendelea na kuhakikisha umeingia. Hakuna kufuatilia kwa watu wengine.',
    settingsBody:
      'Borjie hutumia vidakuzi viwili tu — kwa kipindi cha kuingia na kwa lugha. Hakuna analytics, hakuna pixel za matangazo, hakuna data inayotumwa kwa watu wengine.',
    accept: 'Kubali',
    settings: 'Mipangilio',
    close: 'Funga',
    cookiesHeading: 'Vidakuzi tunavyotumia',
    sessionLabel: 'Cookie ya kipindi',
    sessionDescription:
      'Inakuweka umeingia kwenye Borjie. Inafutwa unapotoka.',
    langLabel: 'Cookie ya lugha (borjie_locale)',
    langDescription:
      'Inakumbuka chaguo lako la Kiswahili au Kiingereza kwa mwaka mmoja.',
    noThirdParty: 'Hakuna vidakuzi vya watu wengine. Hakuna ufuatiliaji.',
    back: 'Rudi',
    learnMore: 'Soma sera ya faragha',
  },
  en: {
    title: 'We use cookies',
    body: 'We use cookies for language preference and session. No third-party tracking.',
    settingsBody:
      'Borjie uses only two cookies — one for your login session and one for your language choice. No analytics, no ad pixels, no third-party data sharing.',
    accept: 'Accept',
    settings: 'Settings',
    close: 'Close',
    cookiesHeading: 'Cookies we use',
    sessionLabel: 'Session cookie',
    sessionDescription:
      'Keeps you signed in to Borjie. Cleared when you sign out.',
    langLabel: 'Language cookie (borjie_locale)',
    langDescription:
      'Remembers your Swahili or English preference for one year.',
    noThirdParty: 'No third-party cookies. No tracking.',
    back: 'Back',
    learnMore: 'Read the privacy policy',
  },
};

function readConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX);
    if (raw === 'accepted' || raw === 'configured') return raw;
  } catch {
    // SSR / privacy mode — treat as no consent recorded.
  }
  return null;
}

function persistConsent(value: ConsentValue): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX, value);
  } catch {
    // Ignore — storage may be blocked. The banner re-appears on next
    // visit, which is the correct degraded behaviour.
  }
}

export function CookieConsent(props: CookieConsentProps) {
  const copy = COPY[props.locale] ?? COPY.sw;
  const [visible, setVisible] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  useEffect(() => {
    // Defer to next tick so SSR + hydration don't flash an unwanted banner.
    const id = window.setTimeout(() => {
      const existing = readConsent();
      if (existing === null) setVisible(true);
    }, 80);
    return () => window.clearTimeout(id);
  }, []);

  function handleAccept(): void {
    persistConsent('accepted');
    setVisible(false);
  }

  function handleSaveSettings(): void {
    persistConsent('configured');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur-md sm:p-6">
        {!showSettings ? (
          <>
            <h2
              id="cookie-consent-title"
              className="font-display text-base font-semibold text-foreground"
            >
              {copy.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {copy.body}
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              <a
                href="/privacy"
                className="text-signal-500 underline-offset-4 hover:underline"
              >
                {copy.learnMore}
              </a>
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-signal-500/60"
              >
                {copy.settings}
              </button>
              <button
                type="button"
                onClick={handleAccept}
                className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-signal-600"
              >
                {copy.accept}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2
              id="cookie-consent-title"
              className="font-display text-base font-semibold text-foreground"
            >
              {copy.cookiesHeading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {copy.settingsBody}
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-foreground">
                  {copy.sessionLabel}
                </dt>
                <dd className="text-neutral-400">{copy.sessionDescription}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">{copy.langLabel}</dt>
                <dd className="text-neutral-400">{copy.langDescription}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs italic text-neutral-500">
              {copy.noThirdParty}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-signal-500/60"
              >
                {copy.back}
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-signal-600"
              >
                {copy.close}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CookieConsent;
