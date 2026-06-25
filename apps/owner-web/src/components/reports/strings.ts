/**
 * strings.ts — bilingual (sw / en) copy for the O-W-18 ReportPlayer.
 *
 * Owner-web does not have a runtime i18n framework wired yet (the
 * LanguageToggle is local-state today, see ~/components/LanguageToggle).
 * Until next-intl lands here, surfaces ship paired sw/en records and
 * pick at render time from a `lang` prop. The keys are stable so they
 * port 1:1 into the eventual messages.json.
 */

import { tailStrings as S } from '@/i18n/strings/tail';

export type Lang = 'sw' | 'en';

export interface ReportPlayerStrings {
  readonly play: string;
  readonly pause: string;
  readonly download: string;
  readonly shareWhatsapp: string;
  readonly speed: string;
  readonly chapters: string;
  readonly transcript: string;
  readonly previousChapter: string;
  readonly nextChapter: string;
  readonly noAudio: string;
  readonly loading: string;
  readonly defaultShareCopy: string;
  readonly recentHeading: string;
  readonly recentLoading: string;
  readonly noRecent: string;
  readonly noSelection: string;
}

/** Project the bilingual `tailStrings.reportPlayer` table onto one locale. */
function reportPlayerFor(lang: Lang): ReportPlayerStrings {
  const r = S.reportPlayer;
  return {
    play: r.play[lang],
    pause: r.pause[lang],
    download: r.download[lang],
    shareWhatsapp: r.shareWhatsapp[lang],
    speed: r.speed[lang],
    chapters: r.chapters[lang],
    transcript: r.transcript[lang],
    previousChapter: r.previousChapter[lang],
    nextChapter: r.nextChapter[lang],
    noAudio: r.noAudio[lang],
    loading: r.loading[lang],
    defaultShareCopy: r.defaultShareCopy[lang],
    recentHeading: r.recentHeading[lang],
    recentLoading: r.recentLoading[lang],
    noRecent: r.noRecent[lang],
    noSelection: r.noSelection[lang],
  };
}

export const REPORT_PLAYER_STRINGS: Readonly<Record<Lang, ReportPlayerStrings>> = {
  sw: reportPlayerFor('sw'),
  en: reportPlayerFor('en'),
};
