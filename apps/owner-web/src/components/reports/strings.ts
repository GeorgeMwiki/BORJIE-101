/**
 * strings.ts — bilingual (sw / en) copy for the O-W-18 ReportPlayer.
 *
 * Owner-web does not have a runtime i18n framework wired yet (the
 * LanguageToggle is local-state today, see ~/components/LanguageToggle).
 * Until next-intl lands here, surfaces ship paired sw/en records and
 * pick at render time from a `lang` prop. The keys are stable so they
 * port 1:1 into the eventual messages.json.
 */

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
}

export const REPORT_PLAYER_STRINGS: Readonly<Record<Lang, ReportPlayerStrings>> = {
  sw: {
    play: 'Cheza',
    pause: 'Simamisha',
    download: 'Pakua',
    shareWhatsapp: 'Tuma kwa WhatsApp',
    speed: 'Mwendo',
    chapters: 'Sura',
    transcript: 'Maandishi',
    previousChapter: 'Sura iliyotangulia',
    nextChapter: 'Sura inayofuata',
    noAudio: 'Hakuna sauti kwa ripoti hii.',
    loading: 'Inapakia ripoti…',
    defaultShareCopy: 'Sikiliza muhtasari wa mmiliki wa Borjie',
  },
  en: {
    play: 'Play',
    pause: 'Pause',
    download: 'Download',
    shareWhatsapp: 'Share on WhatsApp',
    speed: 'Speed',
    chapters: 'Chapters',
    transcript: 'Transcript',
    previousChapter: 'Previous chapter',
    nextChapter: 'Next chapter',
    noAudio: 'No audio for this report.',
    loading: 'Loading report…',
    defaultShareCopy: 'Listen to your Borjie owner brief',
  },
};
