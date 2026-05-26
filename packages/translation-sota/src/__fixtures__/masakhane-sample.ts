/**
 * Translation test fixture.
 *
 * Curated EN↔SW pairs for unit-test purposes only — NEVER imported by
 * production paths. The phrasing is modelled on the Masakhane MT
 * corpus style + Tanzanian mining-domain vocabulary documented in
 * the Wave 19I spec, but every sentence here is hand-written for
 * this repository and ships under the package's own license.
 *
 * Sources / inspiration (NOT copied content):
 *   - Masakhane MakerereNLP: Text & Speech for East Africa
 *     https://www.masakhane.io/ongoing-projects/makererenlp-text-speech-for-east-africa
 *   - Masakhane (Hugging Face)
 *     https://huggingface.co/masakhane
 *   - ACL Anthology 2025.emnlp-main.1413 — Document-level MT Corpus
 *     for African Languages
 *     https://aclanthology.org/2025.emnlp-main.1413.pdf
 *
 * Each pair is paired with a "domain" tag so individual tests can
 * filter to the mining-domain subset they care about.
 */

export interface FixturePair {
  readonly id: string;
  readonly domain: 'mining' | 'general' | 'honorific';
  readonly sw: string;
  readonly en: string;
}

export const FIXTURE_PAIRS: ReadonlyArray<FixturePair> = Object.freeze([
  Object.freeze({
    id: 'mining-pml-arrival',
    domain: 'mining',
    sw: 'Parseli imefika kwa PML.',
    en: 'The parcel arrived at the PML.',
  }),
  Object.freeze({
    id: 'mining-royalty-deduction',
    domain: 'mining',
    sw: 'Mrabaha umekatwa kwenye USD elfu hamsini.',
    en: 'The royalty was deducted from the USD fifty thousand.',
  }),
  Object.freeze({
    id: 'mining-broker-bid',
    domain: 'mining',
    sw: 'Broka anatuletea bid mpya.',
    en: 'The broker is bringing us a new bid.',
  }),
  Object.freeze({
    id: 'honorific-ndugu-opening',
    domain: 'honorific',
    sw: 'Ndugu, parseli imefika.',
    en: 'Dear sir or madam, the parcel has arrived.',
  }),
  Object.freeze({
    id: 'honorific-mzee-respect',
    domain: 'honorific',
    sw: 'Mzee, tunashukuru ushauri wenu.',
    en: 'Respected elder, we appreciate your advice.',
  }),
  Object.freeze({
    id: 'general-greeting',
    domain: 'general',
    sw: 'Habari za asubuhi.',
    en: 'Good morning.',
  }),
]);
