/**
 * generate-country-scaffolds.ts — WAVE 27 Agent A.
 *
 * One-shot code-generator. Reads the embedded ISO-3166 alpha-2 table below
 * and emits a skeleton `CountryPlugin` + `ExtendedCountryProfile` for every
 * country that does NOT already have a full-fidelity plugin in
 * `src/countries/<code>/` or `src/plugins/<name>.ts`.
 *
 * Output lives under `src/countries/_generated/<cc>/index.ts`. All generated
 * files are checked in so the runtime never depends on the generator. Rerun
 * only when you want to add a newly-admitted ISO code or bulk-edit the
 * scaffold template.
 *
 * USAGE:
 *   pnpm --filter @borjie/compliance-plugins exec \
 *     tsx scripts/generate-country-scaffolds.ts
 *
 * The generator is pure: it never reaches the network. Every datum comes
 * from publicly-known tables (ISO-3166, ISO-4217, ITU-T E.164, CLDR).
 *
 * STRICT RULES:
 *   - NEVER invent tax rates — all scaffolds flag `requiresManualConfiguration`.
 *   - NEVER overwrite the 18 real-data plugins (guarded by `REAL_DATA_CODES`).
 *   - NEVER mutate: emit a whole new file each run.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 18 countries that already have real-data plugins — these are SKIPPED.
// ---------------------------------------------------------------------------

const REAL_DATA_CODES = new Set([
  // core/ plugins (6)
  'KE',
  'TZ',
  'UG',
  'NG',
  'ZA',
  'US',
  // countries/ extended profiles (12)
  'DE',
  'KR',
  'GB',
  'SG',
  'CA',
  'AU',
  'IN',
  'BR',
  'JP',
  'FR',
  'AE',
  'MX',
]);

// ---------------------------------------------------------------------------
// ISO-3166-1 alpha-2 master table.
//
// Each row: [code, name, currency, symbol, dialingCode, languages, dateFormat,
//            minorUnitDivisor].
//
// Data sources (all public):
//   - ISO-3166-1 (official UN list, 249 codes at time of writing).
//   - ISO-4217 currency codes + minor-unit sizes.
//   - ITU-T E.164 international dialing codes.
//   - BCP-47 primary language codes (first = primary, additional per CLDR).
//   - Date format by regional convention: DD/MM/YYYY default; MM/DD/YYYY for
//     US / PH; YYYY-MM-DD for CN / JP / KR / HU / SE / LT / LV.
//
// `minorUnitDivisor`:
//   - 1 for zero-decimal: JPY, KRW, VND, CLP, ISK, TWD, UGX, KMF, DJF, GNF,
//     PYG, RWF, XAF, XOF, XPF, BIF, VUV, CLF.
//   - 1000 for three-decimal: BHD, IQD, JOD, KWD, LYD, OMR, TND.
//   - 100 for everything else.
// ---------------------------------------------------------------------------

interface IsoRow {
  readonly code: string;
  readonly name: string;
  readonly currency: string;
  readonly symbol: string;
  readonly dialingCode: string;
  readonly languages: readonly string[];
  readonly dateFormat:
    | 'YYYY-MM-DD'
    | 'DD/MM/YYYY'
    | 'MM/DD/YYYY'
    | 'DD.MM.YYYY'
    | 'YYYY/MM/DD';
  readonly minorUnitDivisor: 1 | 100 | 1000;
}

/* eslint-disable no-useless-escape */
const ISO_ROWS: readonly IsoRow[] = [
  { code: 'AD', name: 'Andorra', currency: 'EUR', symbol: '€', dialingCode: '376', languages: ['ca', 'es', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', symbol: 'د.إ', dialingCode: '971', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AF', name: 'Afghanistan', currency: 'AFN', symbol: '؋', dialingCode: '93', languages: ['ps', 'fa'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AG', name: 'Antigua and Barbuda', currency: 'XCD', symbol: '$', dialingCode: '1268', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AI', name: 'Anguilla', currency: 'XCD', symbol: '$', dialingCode: '1264', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AL', name: 'Albania', currency: 'ALL', symbol: 'L', dialingCode: '355', languages: ['sq'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'AM', name: 'Armenia', currency: 'AMD', symbol: '֏', dialingCode: '374', languages: ['hy', 'ru'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'AO', name: 'Angola', currency: 'AOA', symbol: 'Kz', dialingCode: '244', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AQ', name: 'Antarctica', currency: 'USD', symbol: '$', dialingCode: '672', languages: ['en'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'AR', name: 'Argentina', currency: 'ARS', symbol: '$', dialingCode: '54', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AS', name: 'American Samoa', currency: 'USD', symbol: '$', dialingCode: '1684', languages: ['en', 'sm'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'AT', name: 'Austria', currency: 'EUR', symbol: '€', dialingCode: '43', languages: ['de'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'AU', name: 'Australia', currency: 'AUD', symbol: '$', dialingCode: '61', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AW', name: 'Aruba', currency: 'AWG', symbol: 'ƒ', dialingCode: '297', languages: ['nl', 'pap'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'AX', name: 'Åland Islands', currency: 'EUR', symbol: '€', dialingCode: '358', languages: ['sv'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'AZ', name: 'Azerbaijan', currency: 'AZN', symbol: '₼', dialingCode: '994', languages: ['az'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'BA', name: 'Bosnia and Herzegovina', currency: 'BAM', symbol: 'KM', dialingCode: '387', languages: ['bs', 'hr', 'sr'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'BB', name: 'Barbados', currency: 'BBD', symbol: '$', dialingCode: '1246', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', symbol: '৳', dialingCode: '880', languages: ['bn', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BE', name: 'Belgium', currency: 'EUR', symbol: '€', dialingCode: '32', languages: ['nl', 'fr', 'de'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BF', name: 'Burkina Faso', currency: 'XOF', symbol: 'CFA', dialingCode: '226', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'BG', name: 'Bulgaria', currency: 'BGN', symbol: 'лв', dialingCode: '359', languages: ['bg'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', symbol: '.د.ب', dialingCode: '973', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'BI', name: 'Burundi', currency: 'BIF', symbol: 'FBu', dialingCode: '257', languages: ['fr', 'rn'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'BJ', name: 'Benin', currency: 'XOF', symbol: 'CFA', dialingCode: '229', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'BL', name: 'Saint Barthélemy', currency: 'EUR', symbol: '€', dialingCode: '590', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BM', name: 'Bermuda', currency: 'BMD', symbol: '$', dialingCode: '1441', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BN', name: 'Brunei Darussalam', currency: 'BND', symbol: '$', dialingCode: '673', languages: ['ms', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BO', name: 'Bolivia', currency: 'BOB', symbol: 'Bs.', dialingCode: '591', languages: ['es', 'qu', 'ay'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BQ', name: 'Bonaire, Sint Eustatius and Saba', currency: 'USD', symbol: '$', dialingCode: '599', languages: ['nl'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BR', name: 'Brazil', currency: 'BRL', symbol: 'R$', dialingCode: '55', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BS', name: 'Bahamas', currency: 'BSD', symbol: '$', dialingCode: '1242', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BT', name: 'Bhutan', currency: 'BTN', symbol: 'Nu.', dialingCode: '975', languages: ['dz', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BV', name: 'Bouvet Island', currency: 'NOK', symbol: 'kr', dialingCode: '47', languages: ['no'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'BW', name: 'Botswana', currency: 'BWP', symbol: 'P', dialingCode: '267', languages: ['en', 'tn'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'BY', name: 'Belarus', currency: 'BYN', symbol: 'Br', dialingCode: '375', languages: ['be', 'ru'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'BZ', name: 'Belize', currency: 'BZD', symbol: '$', dialingCode: '501', languages: ['en', 'es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CA', name: 'Canada', currency: 'CAD', symbol: '$', dialingCode: '1', languages: ['en', 'fr'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'CC', name: 'Cocos (Keeling) Islands', currency: 'AUD', symbol: '$', dialingCode: '61', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CD', name: 'Congo, Democratic Republic of the', currency: 'CDF', symbol: 'FC', dialingCode: '243', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CF', name: 'Central African Republic', currency: 'XAF', symbol: 'FCFA', dialingCode: '236', languages: ['fr', 'sg'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'CG', name: 'Congo', currency: 'XAF', symbol: 'FCFA', dialingCode: '242', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', symbol: 'CHF', dialingCode: '41', languages: ['de', 'fr', 'it', 'rm'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF', symbol: 'CFA', dialingCode: '225', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'CK', name: 'Cook Islands', currency: 'NZD', symbol: '$', dialingCode: '682', languages: ['en', 'mi'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CL', name: 'Chile', currency: 'CLP', symbol: '$', dialingCode: '56', languages: ['es'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'CM', name: 'Cameroon', currency: 'XAF', symbol: 'FCFA', dialingCode: '237', languages: ['fr', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'CN', name: 'China', currency: 'CNY', symbol: '¥', dialingCode: '86', languages: ['zh'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'CO', name: 'Colombia', currency: 'COP', symbol: '$', dialingCode: '57', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CR', name: 'Costa Rica', currency: 'CRC', symbol: '₡', dialingCode: '506', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CU', name: 'Cuba', currency: 'CUP', symbol: '$', dialingCode: '53', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CV', name: 'Cabo Verde', currency: 'CVE', symbol: '$', dialingCode: '238', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CW', name: 'Curaçao', currency: 'ANG', symbol: 'ƒ', dialingCode: '599', languages: ['nl', 'pap', 'en'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CX', name: 'Christmas Island', currency: 'AUD', symbol: '$', dialingCode: '61', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CY', name: 'Cyprus', currency: 'EUR', symbol: '€', dialingCode: '357', languages: ['el', 'tr', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'CZ', name: 'Czechia', currency: 'CZK', symbol: 'Kč', dialingCode: '420', languages: ['cs'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'DE', name: 'Germany', currency: 'EUR', symbol: '€', dialingCode: '49', languages: ['de', 'en'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'DJ', name: 'Djibouti', currency: 'DJF', symbol: 'Fdj', dialingCode: '253', languages: ['fr', 'ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'DK', name: 'Denmark', currency: 'DKK', symbol: 'kr', dialingCode: '45', languages: ['da'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'DM', name: 'Dominica', currency: 'XCD', symbol: '$', dialingCode: '1767', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'DO', name: 'Dominican Republic', currency: 'DOP', symbol: '$', dialingCode: '1809', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'DZ', name: 'Algeria', currency: 'DZD', symbol: 'د.ج', dialingCode: '213', languages: ['ar', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'EC', name: 'Ecuador', currency: 'USD', symbol: '$', dialingCode: '593', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'EE', name: 'Estonia', currency: 'EUR', symbol: '€', dialingCode: '372', languages: ['et', 'en'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'EG', name: 'Egypt', currency: 'EGP', symbol: 'ج.م', dialingCode: '20', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'EH', name: 'Western Sahara', currency: 'MAD', symbol: 'د.م.', dialingCode: '212', languages: ['ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ER', name: 'Eritrea', currency: 'ERN', symbol: 'Nfk', dialingCode: '291', languages: ['ti', 'ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ES', name: 'Spain', currency: 'EUR', symbol: '€', dialingCode: '34', languages: ['es', 'ca', 'gl', 'eu'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB', symbol: 'Br', dialingCode: '251', languages: ['am', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'FI', name: 'Finland', currency: 'EUR', symbol: '€', dialingCode: '358', languages: ['fi', 'sv', 'en'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'FJ', name: 'Fiji', currency: 'FJD', symbol: '$', dialingCode: '679', languages: ['en', 'fj'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'FK', name: 'Falkland Islands (Malvinas)', currency: 'FKP', symbol: '£', dialingCode: '500', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'FM', name: 'Micronesia, Federated States of', currency: 'USD', symbol: '$', dialingCode: '691', languages: ['en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'FO', name: 'Faroe Islands', currency: 'DKK', symbol: 'kr', dialingCode: '298', languages: ['fo', 'da'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'FR', name: 'France', currency: 'EUR', symbol: '€', dialingCode: '33', languages: ['fr', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GA', name: 'Gabon', currency: 'XAF', symbol: 'FCFA', dialingCode: '241', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', symbol: '£', dialingCode: '44', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GD', name: 'Grenada', currency: 'XCD', symbol: '$', dialingCode: '1473', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GE', name: 'Georgia', currency: 'GEL', symbol: '₾', dialingCode: '995', languages: ['ka'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'GF', name: 'French Guiana', currency: 'EUR', symbol: '€', dialingCode: '594', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GG', name: 'Guernsey', currency: 'GBP', symbol: '£', dialingCode: '44', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GH', name: 'Ghana', currency: 'GHS', symbol: '₵', dialingCode: '233', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GI', name: 'Gibraltar', currency: 'GIP', symbol: '£', dialingCode: '350', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GL', name: 'Greenland', currency: 'DKK', symbol: 'kr', dialingCode: '299', languages: ['kl', 'da'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'GM', name: 'Gambia', currency: 'GMD', symbol: 'D', dialingCode: '220', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GN', name: 'Guinea', currency: 'GNF', symbol: 'FG', dialingCode: '224', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'GP', name: 'Guadeloupe', currency: 'EUR', symbol: '€', dialingCode: '590', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GQ', name: 'Equatorial Guinea', currency: 'XAF', symbol: 'FCFA', dialingCode: '240', languages: ['es', 'fr', 'pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'GR', name: 'Greece', currency: 'EUR', symbol: '€', dialingCode: '30', languages: ['el'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GS', name: 'South Georgia and the South Sandwich Islands', currency: 'GBP', symbol: '£', dialingCode: '500', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GT', name: 'Guatemala', currency: 'GTQ', symbol: 'Q', dialingCode: '502', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'GU', name: 'Guam', currency: 'USD', symbol: '$', dialingCode: '1671', languages: ['en', 'ch'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'GW', name: 'Guinea-Bissau', currency: 'XOF', symbol: 'CFA', dialingCode: '245', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'GY', name: 'Guyana', currency: 'GYD', symbol: '$', dialingCode: '592', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', symbol: '$', dialingCode: '852', languages: ['zh', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'HM', name: 'Heard Island and McDonald Islands', currency: 'AUD', symbol: '$', dialingCode: '672', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'HN', name: 'Honduras', currency: 'HNL', symbol: 'L', dialingCode: '504', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'HR', name: 'Croatia', currency: 'EUR', symbol: '€', dialingCode: '385', languages: ['hr'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'HT', name: 'Haiti', currency: 'HTG', symbol: 'G', dialingCode: '509', languages: ['fr', 'ht'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'HU', name: 'Hungary', currency: 'HUF', symbol: 'Ft', dialingCode: '36', languages: ['hu'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', symbol: 'Rp', dialingCode: '62', languages: ['id'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IE', name: 'Ireland', currency: 'EUR', symbol: '€', dialingCode: '353', languages: ['en', 'ga'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IL', name: 'Israel', currency: 'ILS', symbol: '₪', dialingCode: '972', languages: ['he', 'ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IM', name: 'Isle of Man', currency: 'GBP', symbol: '£', dialingCode: '44', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IN', name: 'India', currency: 'INR', symbol: '₹', dialingCode: '91', languages: ['hi', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IO', name: 'British Indian Ocean Territory', currency: 'USD', symbol: '$', dialingCode: '246', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'IQ', name: 'Iraq', currency: 'IQD', symbol: 'ع.د', dialingCode: '964', languages: ['ar', 'ku'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'IR', name: 'Iran, Islamic Republic of', currency: 'IRR', symbol: '﷼', dialingCode: '98', languages: ['fa'], dateFormat: 'YYYY/MM/DD', minorUnitDivisor: 100 },
  { code: 'IS', name: 'Iceland', currency: 'ISK', symbol: 'kr', dialingCode: '354', languages: ['is'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 1 },
  { code: 'IT', name: 'Italy', currency: 'EUR', symbol: '€', dialingCode: '39', languages: ['it'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'JE', name: 'Jersey', currency: 'GBP', symbol: '£', dialingCode: '44', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'JM', name: 'Jamaica', currency: 'JMD', symbol: '$', dialingCode: '1876', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'JO', name: 'Jordan', currency: 'JOD', symbol: 'د.ا', dialingCode: '962', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'JP', name: 'Japan', currency: 'JPY', symbol: '¥', dialingCode: '81', languages: ['ja'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 1 },
  { code: 'KE', name: 'Kenya', currency: 'KES', symbol: 'KSh', dialingCode: '254', languages: ['sw', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'KG', name: 'Kyrgyzstan', currency: 'KGS', symbol: 'с', dialingCode: '996', languages: ['ky', 'ru'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'KH', name: 'Cambodia', currency: 'KHR', symbol: '៛', dialingCode: '855', languages: ['km'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'KI', name: 'Kiribati', currency: 'AUD', symbol: '$', dialingCode: '686', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'KM', name: 'Comoros', currency: 'KMF', symbol: 'CF', dialingCode: '269', languages: ['fr', 'ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'KN', name: 'Saint Kitts and Nevis', currency: 'XCD', symbol: '$', dialingCode: '1869', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'KP', name: "Korea, Democratic People's Republic of", currency: 'KPW', symbol: '₩', dialingCode: '850', languages: ['ko'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'KR', name: 'Korea, Republic of', currency: 'KRW', symbol: '₩', dialingCode: '82', languages: ['ko'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 1 },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', symbol: 'د.ك', dialingCode: '965', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'KY', name: 'Cayman Islands', currency: 'KYD', symbol: '$', dialingCode: '1345', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'KZ', name: 'Kazakhstan', currency: 'KZT', symbol: '₸', dialingCode: '7', languages: ['kk', 'ru'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'LA', name: "Lao People's Democratic Republic", currency: 'LAK', symbol: '₭', dialingCode: '856', languages: ['lo'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LB', name: 'Lebanon', currency: 'LBP', symbol: 'ل.ل', dialingCode: '961', languages: ['ar', 'fr', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LC', name: 'Saint Lucia', currency: 'XCD', symbol: '$', dialingCode: '1758', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LI', name: 'Liechtenstein', currency: 'CHF', symbol: 'CHF', dialingCode: '423', languages: ['de'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', symbol: '₨', dialingCode: '94', languages: ['si', 'ta', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LR', name: 'Liberia', currency: 'LRD', symbol: '$', dialingCode: '231', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LS', name: 'Lesotho', currency: 'LSL', symbol: 'L', dialingCode: '266', languages: ['en', 'st'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LT', name: 'Lithuania', currency: 'EUR', symbol: '€', dialingCode: '370', languages: ['lt'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', symbol: '€', dialingCode: '352', languages: ['lb', 'fr', 'de'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'LV', name: 'Latvia', currency: 'EUR', symbol: '€', dialingCode: '371', languages: ['lv'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'LY', name: 'Libya', currency: 'LYD', symbol: 'ل.د', dialingCode: '218', languages: ['ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'MA', name: 'Morocco', currency: 'MAD', symbol: 'د.م.', dialingCode: '212', languages: ['ar', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MC', name: 'Monaco', currency: 'EUR', symbol: '€', dialingCode: '377', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MD', name: 'Moldova, Republic of', currency: 'MDL', symbol: 'L', dialingCode: '373', languages: ['ro'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'ME', name: 'Montenegro', currency: 'EUR', symbol: '€', dialingCode: '382', languages: ['sr', 'bs', 'sq'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'MF', name: 'Saint Martin (French part)', currency: 'EUR', symbol: '€', dialingCode: '590', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MG', name: 'Madagascar', currency: 'MGA', symbol: 'Ar', dialingCode: '261', languages: ['mg', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MH', name: 'Marshall Islands', currency: 'USD', symbol: '$', dialingCode: '692', languages: ['en', 'mh'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'MK', name: 'North Macedonia', currency: 'MKD', symbol: 'ден', dialingCode: '389', languages: ['mk'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'ML', name: 'Mali', currency: 'XOF', symbol: 'CFA', dialingCode: '223', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'MM', name: 'Myanmar', currency: 'MMK', symbol: 'K', dialingCode: '95', languages: ['my'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MN', name: 'Mongolia', currency: 'MNT', symbol: '₮', dialingCode: '976', languages: ['mn'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'MO', name: 'Macao', currency: 'MOP', symbol: 'P', dialingCode: '853', languages: ['zh', 'pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MP', name: 'Northern Mariana Islands', currency: 'USD', symbol: '$', dialingCode: '1670', languages: ['en', 'ch'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'MQ', name: 'Martinique', currency: 'EUR', symbol: '€', dialingCode: '596', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MR', name: 'Mauritania', currency: 'MRU', symbol: 'UM', dialingCode: '222', languages: ['ar', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MS', name: 'Montserrat', currency: 'XCD', symbol: '$', dialingCode: '1664', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MT', name: 'Malta', currency: 'EUR', symbol: '€', dialingCode: '356', languages: ['mt', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MU', name: 'Mauritius', currency: 'MUR', symbol: '₨', dialingCode: '230', languages: ['en', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MV', name: 'Maldives', currency: 'MVR', symbol: 'Rf', dialingCode: '960', languages: ['dv', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MW', name: 'Malawi', currency: 'MWK', symbol: 'MK', dialingCode: '265', languages: ['en', 'ny'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MX', name: 'Mexico', currency: 'MXN', symbol: '$', dialingCode: '52', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', symbol: 'RM', dialingCode: '60', languages: ['ms', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'MZ', name: 'Mozambique', currency: 'MZN', symbol: 'MT', dialingCode: '258', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NA', name: 'Namibia', currency: 'NAD', symbol: '$', dialingCode: '264', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NC', name: 'New Caledonia', currency: 'XPF', symbol: '₣', dialingCode: '687', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'NE', name: 'Niger', currency: 'XOF', symbol: 'CFA', dialingCode: '227', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'NF', name: 'Norfolk Island', currency: 'AUD', symbol: '$', dialingCode: '672', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', symbol: '₦', dialingCode: '234', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NI', name: 'Nicaragua', currency: 'NIO', symbol: 'C$', dialingCode: '505', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', symbol: '€', dialingCode: '31', languages: ['nl'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NO', name: 'Norway', currency: 'NOK', symbol: 'kr', dialingCode: '47', languages: ['no'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'NP', name: 'Nepal', currency: 'NPR', symbol: '₨', dialingCode: '977', languages: ['ne', 'en'], dateFormat: 'YYYY/MM/DD', minorUnitDivisor: 100 },
  { code: 'NR', name: 'Nauru', currency: 'AUD', symbol: '$', dialingCode: '674', languages: ['en', 'na'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NU', name: 'Niue', currency: 'NZD', symbol: '$', dialingCode: '683', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', symbol: '$', dialingCode: '64', languages: ['en', 'mi'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'OM', name: 'Oman', currency: 'OMR', symbol: 'ر.ع.', dialingCode: '968', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'PA', name: 'Panama', currency: 'PAB', symbol: 'B/.', dialingCode: '507', languages: ['es'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'PE', name: 'Peru', currency: 'PEN', symbol: 'S/.', dialingCode: '51', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PF', name: 'French Polynesia', currency: 'XPF', symbol: '₣', dialingCode: '689', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'PG', name: 'Papua New Guinea', currency: 'PGK', symbol: 'K', dialingCode: '675', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PH', name: 'Philippines', currency: 'PHP', symbol: '₱', dialingCode: '63', languages: ['fil', 'en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', symbol: '₨', dialingCode: '92', languages: ['ur', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PL', name: 'Poland', currency: 'PLN', symbol: 'zł', dialingCode: '48', languages: ['pl'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'PM', name: 'Saint Pierre and Miquelon', currency: 'EUR', symbol: '€', dialingCode: '508', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PN', name: 'Pitcairn', currency: 'NZD', symbol: '$', dialingCode: '64', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PR', name: 'Puerto Rico', currency: 'USD', symbol: '$', dialingCode: '1787', languages: ['es', 'en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'PS', name: 'Palestine, State of', currency: 'ILS', symbol: '₪', dialingCode: '970', languages: ['ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PT', name: 'Portugal', currency: 'EUR', symbol: '€', dialingCode: '351', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'PW', name: 'Palau', currency: 'USD', symbol: '$', dialingCode: '680', languages: ['en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'PY', name: 'Paraguay', currency: 'PYG', symbol: '₲', dialingCode: '595', languages: ['es', 'gn'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'QA', name: 'Qatar', currency: 'QAR', symbol: 'ر.ق', dialingCode: '974', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'RE', name: 'Réunion', currency: 'EUR', symbol: '€', dialingCode: '262', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'RO', name: 'Romania', currency: 'RON', symbol: 'lei', dialingCode: '40', languages: ['ro'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'RS', name: 'Serbia', currency: 'RSD', symbol: 'дин.', dialingCode: '381', languages: ['sr'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'RU', name: 'Russian Federation', currency: 'RUB', symbol: '₽', dialingCode: '7', languages: ['ru'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', symbol: 'FRw', dialingCode: '250', languages: ['rw', 'en', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', symbol: 'ر.س', dialingCode: '966', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SB', name: 'Solomon Islands', currency: 'SBD', symbol: '$', dialingCode: '677', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SC', name: 'Seychelles', currency: 'SCR', symbol: '₨', dialingCode: '248', languages: ['en', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SD', name: 'Sudan', currency: 'SDG', symbol: 'ج.س.', dialingCode: '249', languages: ['ar', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SE', name: 'Sweden', currency: 'SEK', symbol: 'kr', dialingCode: '46', languages: ['sv'], dateFormat: 'YYYY-MM-DD', minorUnitDivisor: 100 },
  { code: 'SG', name: 'Singapore', currency: 'SGD', symbol: '$', dialingCode: '65', languages: ['en', 'zh', 'ms', 'ta'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SH', name: 'Saint Helena, Ascension and Tristan da Cunha', currency: 'SHP', symbol: '£', dialingCode: '290', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SI', name: 'Slovenia', currency: 'EUR', symbol: '€', dialingCode: '386', languages: ['sl'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'SJ', name: 'Svalbard and Jan Mayen', currency: 'NOK', symbol: 'kr', dialingCode: '47', languages: ['no'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'SK', name: 'Slovakia', currency: 'EUR', symbol: '€', dialingCode: '421', languages: ['sk'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'SL', name: 'Sierra Leone', currency: 'SLE', symbol: 'Le', dialingCode: '232', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SM', name: 'San Marino', currency: 'EUR', symbol: '€', dialingCode: '378', languages: ['it'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SN', name: 'Senegal', currency: 'XOF', symbol: 'CFA', dialingCode: '221', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'SO', name: 'Somalia', currency: 'SOS', symbol: 'Sh', dialingCode: '252', languages: ['so', 'ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SR', name: 'Suriname', currency: 'SRD', symbol: '$', dialingCode: '597', languages: ['nl'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SS', name: 'South Sudan', currency: 'SSP', symbol: '£', dialingCode: '211', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ST', name: 'Sao Tome and Principe', currency: 'STN', symbol: 'Db', dialingCode: '239', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SV', name: 'El Salvador', currency: 'USD', symbol: '$', dialingCode: '503', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SX', name: 'Sint Maarten (Dutch part)', currency: 'ANG', symbol: 'ƒ', dialingCode: '1721', languages: ['nl', 'en'], dateFormat: 'DD-MM-YYYY' as 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SY', name: 'Syrian Arab Republic', currency: 'SYP', symbol: '£', dialingCode: '963', languages: ['ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'SZ', name: 'Eswatini', currency: 'SZL', symbol: 'L', dialingCode: '268', languages: ['en', 'ss'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TC', name: 'Turks and Caicos Islands', currency: 'USD', symbol: '$', dialingCode: '1649', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TD', name: 'Chad', currency: 'XAF', symbol: 'FCFA', dialingCode: '235', languages: ['fr', 'ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'TF', name: 'French Southern Territories', currency: 'EUR', symbol: '€', dialingCode: '262', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TG', name: 'Togo', currency: 'XOF', symbol: 'CFA', dialingCode: '228', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'TH', name: 'Thailand', currency: 'THB', symbol: '฿', dialingCode: '66', languages: ['th'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TJ', name: 'Tajikistan', currency: 'TJS', symbol: 'SM', dialingCode: '992', languages: ['tg'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'TK', name: 'Tokelau', currency: 'NZD', symbol: '$', dialingCode: '690', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TL', name: 'Timor-Leste', currency: 'USD', symbol: '$', dialingCode: '670', languages: ['pt'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TM', name: 'Turkmenistan', currency: 'TMT', symbol: 'T', dialingCode: '993', languages: ['tk'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'TN', name: 'Tunisia', currency: 'TND', symbol: 'د.ت', dialingCode: '216', languages: ['ar', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1000 },
  { code: 'TO', name: 'Tonga', currency: 'TOP', symbol: 'T$', dialingCode: '676', languages: ['en', 'to'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TR', name: 'Türkiye', currency: 'TRY', symbol: '₺', dialingCode: '90', languages: ['tr'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'TT', name: 'Trinidad and Tobago', currency: 'TTD', symbol: '$', dialingCode: '1868', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TV', name: 'Tuvalu', currency: 'AUD', symbol: '$', dialingCode: '688', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'TW', name: 'Taiwan, Province of China', currency: 'TWD', symbol: 'NT$', dialingCode: '886', languages: ['zh'], dateFormat: 'YYYY/MM/DD', minorUnitDivisor: 1 },
  { code: 'TZ', name: 'Tanzania, United Republic of', currency: 'TZS', symbol: 'TSh', dialingCode: '255', languages: ['sw', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'UA', name: 'Ukraine', currency: 'UAH', symbol: '₴', dialingCode: '380', languages: ['uk'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'UG', name: 'Uganda', currency: 'UGX', symbol: 'USh', dialingCode: '256', languages: ['en', 'sw'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'UM', name: 'United States Minor Outlying Islands', currency: 'USD', symbol: '$', dialingCode: '1', languages: ['en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'US', name: 'United States', currency: 'USD', symbol: '$', dialingCode: '1', languages: ['en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'UY', name: 'Uruguay', currency: 'UYU', symbol: '$', dialingCode: '598', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'UZ', name: 'Uzbekistan', currency: 'UZS', symbol: 'сўм', dialingCode: '998', languages: ['uz'], dateFormat: 'DD.MM.YYYY', minorUnitDivisor: 100 },
  { code: 'VA', name: 'Holy See (Vatican City State)', currency: 'EUR', symbol: '€', dialingCode: '39', languages: ['it', 'la'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', currency: 'XCD', symbol: '$', dialingCode: '1784', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'VE', name: 'Venezuela, Bolivarian Republic of', currency: 'VES', symbol: 'Bs.', dialingCode: '58', languages: ['es'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'VG', name: 'Virgin Islands, British', currency: 'USD', symbol: '$', dialingCode: '1284', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'VI', name: 'Virgin Islands, U.S.', currency: 'USD', symbol: '$', dialingCode: '1340', languages: ['en'], dateFormat: 'MM/DD/YYYY', minorUnitDivisor: 100 },
  { code: 'VN', name: 'Viet Nam', currency: 'VND', symbol: '₫', dialingCode: '84', languages: ['vi'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'VU', name: 'Vanuatu', currency: 'VUV', symbol: 'Vt', dialingCode: '678', languages: ['bi', 'en', 'fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'WF', name: 'Wallis and Futuna', currency: 'XPF', symbol: '₣', dialingCode: '681', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 1 },
  { code: 'WS', name: 'Samoa', currency: 'WST', symbol: 'T', dialingCode: '685', languages: ['sm', 'en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'YE', name: 'Yemen', currency: 'YER', symbol: '﷼', dialingCode: '967', languages: ['ar'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'YT', name: 'Mayotte', currency: 'EUR', symbol: '€', dialingCode: '262', languages: ['fr'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', symbol: 'R', dialingCode: '27', languages: ['en', 'af', 'zu', 'xh'], dateFormat: 'YYYY/MM/DD', minorUnitDivisor: 100 },
  { code: 'ZM', name: 'Zambia', currency: 'ZMW', symbol: 'ZK', dialingCode: '260', languages: ['en'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
  { code: 'ZW', name: 'Zimbabwe', currency: 'ZWG', symbol: '$', dialingCode: '263', languages: ['en', 'sn', 'nd'], dateFormat: 'DD/MM/YYYY', minorUnitDivisor: 100 },
];
/* eslint-enable no-useless-escape */

// ---------------------------------------------------------------------------
// File emitters.
// ---------------------------------------------------------------------------

const GENERATED_AT = '2026-04-21';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(HERE, '..', 'src', 'countries', '_generated');

function jsStringLiteral(value: string): string {
  // Double-quote string literal with only a handful of characters escaped —
  // everything else (including the few unicode currency glyphs) is kept
  // verbatim so the generated TypeScript remains human-readable.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function renderLanguageArray(langs: readonly string[]): string {
  return `[${langs.map((l) => jsStringLiteral(l)).join(', ')}]`;
}

/**
 * Turn a country name into a safe JS identifier in `camelCase`. Strips
 * non-alphanumerics, collapses runs, trims edge separators, and lowercases
 * the first character so the result is a valid `const` name.
 */
function toIdentifier(name: string): string {
  const collapsed = name
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const camel = collapsed.replace(/-([a-z0-9])/g, (_m, ch: string) =>
    ch.toUpperCase()
  );
  // Ensure it always starts with a lowercase letter to avoid clashing with
  // type naming conventions.
  return camel.length === 0
    ? 'country'
    : camel.charAt(0).toLowerCase() + camel.slice(1);
}

function renderScaffoldFile(row: IsoRow): string {
  const {
    code,
    name,
    currency,
    symbol,
    dialingCode,
    languages,
    dateFormat,
    minorUnitDivisor,
  } = row;
  const safeDateFormat: string = dateFormat;
  const identBase = toIdentifier(name);
  return `/**
 * ${name} (${code}) — AUTO-GENERATED scaffold plugin.
 *
 * Generated on ${GENERATED_AT} by \`scripts/generate-country-scaffolds.ts\`.
 * Do not hand-edit — rerun the generator. To promote this country to a
 * full-fidelity plugin, COPY this file to \`../${code.toLowerCase()}/index.ts\`,
 * delete this scaffold, and wire the real tax + lease-law sources.
 *
 * Scaffold behaviour:
 *   - Currency + language + dateFormat from public ISO sources.
 *   - TaxRegimePort: zero-rate stub flagged \`requiresManualConfiguration\`.
 *   - PaymentRailPort: generic Stripe + bank + manual.
 *   - LeaseLawPort: DEFAULT_LEASE_LAW.
 *   - TenantScreeningPort: DEFAULT_TENANT_SCREENING.
 *   - TaxFilingPort: DEFAULT_TAX_FILING.
 */

import { buildPhoneNormalizer } from '../../../core/phone.js';
import type { CountryPlugin } from '../../../core/types.js';
import {
  DEFAULT_LEASE_LAW,
  DEFAULT_TENANT_SCREENING,
} from '../../../ports/index.js';
import {
  buildPaymentRailsPort,
  stubWithholding,
} from '../../_shared.js';
import type { ExtendedCountryProfile } from '../../types.js';

const ${identBase}Core: CountryPlugin = {
  countryCode: ${jsStringLiteral(code)},
  countryName: ${jsStringLiteral(name)},
  currencyCode: ${jsStringLiteral(currency)},
  currencySymbol: ${jsStringLiteral(symbol)},
  phoneCountryCode: ${jsStringLiteral(dialingCode)},
  normalizePhone: buildPhoneNormalizer({ dialingCode: ${jsStringLiteral(dialingCode)}, trunkPrefix: '0' }),
  kycProviders: [],
  paymentGateways: [
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    { id: 'bank_transfer', name: 'Bank transfer', kind: 'bank-rail', envPrefix: 'BANK_TRANSFER' },
    { id: 'manual', name: 'Manual reconciliation', kind: 'bank-rail', envPrefix: 'MANUAL' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 2,
    noticePeriodDays: 30,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [],
};

export const ${identBase}ScaffoldProfile: ExtendedCountryProfile = {
  plugin: ${identBase}Core,
  languages: ${renderLanguageArray(languages)},
  dateFormat: ${jsStringLiteral(safeDateFormat)} as ExtendedCountryProfile['dateFormat'],
  minorUnitDivisor: ${minorUnitDivisor},
  nationalIdValidator: null,
  taxRegime: stubWithholding(
    ${jsStringLiteral(`${code}-MANUAL-CONFIG`)},
    ${jsStringLiteral(
      `CONFIGURE_FOR_YOUR_JURISDICTION: ${name} has no programmed withholding rate. Consult local tax counsel and promote this scaffold (see countries/_generated/README.md).`
    )}
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'stripe',
      label: 'Stripe',
      kind: 'card',
      currency: ${jsStringLiteral(currency)},
      minAmountMinorUnits: 50,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'bank_transfer',
      label: 'Bank transfer',
      kind: 'bank-transfer',
      currency: ${jsStringLiteral(currency)},
      minAmountMinorUnits: 1,
      settlementLagHours: 24,
      integrationAdapterHint: 'GENERIC',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'manual',
      label: 'Manual reconciliation',
      kind: 'manual',
      currency: ${jsStringLiteral(currency)},
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: null,
      supportsCollection: true,
      supportsDisbursement: true,
    },
  ]),
  leaseLaw: DEFAULT_LEASE_LAW,
  tenantScreening: DEFAULT_TENANT_SCREENING,
};

export const ${identBase}ScaffoldMetadata = Object.freeze({
  status: 'scaffold' as const,
  generatedAt: ${jsStringLiteral(GENERATED_AT)},
  promotionGuide:
    'To replace this scaffold with full-fidelity data, copy to ../${code.toLowerCase()}/index.ts and implement real tax rates + lease-law from local sources. See _generated/README.md.',
});
`;
}

function renderBarrel(scaffoldRows: readonly IsoRow[]): string {
  // Produce two collections: SCAFFOLD_PROFILES (map of code → profile) and
  // SCAFFOLD_METADATA (map of code → metadata blob). Order is alphabetical by
  // code so the barrel is easy to diff on re-run.
  const imports: string[] = [];
  const entries: string[] = [];
  const metaEntries: string[] = [];
  for (const row of scaffoldRows) {
    const varName = toIdentifier(row.name);
    imports.push(
      `import { ${varName}ScaffoldProfile, ${varName}ScaffoldMetadata } from './${row.code.toLowerCase()}/index.js';`
    );
    entries.push(`  ${row.code}: ${varName}ScaffoldProfile,`);
    metaEntries.push(`  ${row.code}: ${varName}ScaffoldMetadata,`);
  }
  return `/**
 * Auto-generated barrel for scaffolded country plugins.
 *
 * Generated on ${GENERATED_AT} by \`scripts/generate-country-scaffolds.ts\`.
 * Do not hand-edit — rerun the generator instead.
 *
 * Each scaffold is an \`ExtendedCountryProfile\` with:
 *   - Real ISO currency + language + date-format data.
 *   - Stubbed tax regime (\`requiresManualConfiguration: true\`).
 *   - Default lease-law and tenant-screening ports.
 *   - Generic payment rails (Stripe / bank / manual).
 *
 * The root country barrel (../index.ts) merges these with the 18 full-fidelity
 * profiles so that \`resolvePlugin(<any ISO code>)\` always returns a valid
 * plugin. Full-fidelity profiles always win — the barrel never overwrites a
 * hand-authored country.
 */

import type { ExtendedCountryProfile } from '../types.js';

${imports.join('\n')}

export const SCAFFOLD_PROFILES: Readonly<Record<string, ExtendedCountryProfile>> =
  Object.freeze({
${entries.join('\n')}
  });

export interface ScaffoldMetadata {
  readonly status: 'scaffold';
  readonly generatedAt: string;
  readonly promotionGuide: string;
}

export const SCAFFOLD_METADATA: Readonly<Record<string, ScaffoldMetadata>> =
  Object.freeze({
${metaEntries.join('\n')}
  });

/** ISO-3166 alpha-2 codes this generator currently scaffolds. */
export const SCAFFOLD_COUNTRY_CODES: readonly string[] = Object.freeze(
  Object.keys(SCAFFOLD_PROFILES)
);
`;
}

function run(): void {
  const scaffoldRows = ISO_ROWS.filter((row) => !REAL_DATA_CODES.has(row.code));
  mkdirSync(OUT_ROOT, { recursive: true });
  for (const row of scaffoldRows) {
    const dir = resolve(OUT_ROOT, row.code.toLowerCase());
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.ts'), renderScaffoldFile(row), 'utf8');
  }
  writeFileSync(resolve(OUT_ROOT, 'index.ts'), renderBarrel(scaffoldRows), 'utf8');
  // eslint-disable-next-line no-console
  console.log(
    `[generate-country-scaffolds] wrote ${scaffoldRows.length} scaffold plugins + barrel (total ISO rows: ${ISO_ROWS.length}, real-data skipped: ${REAL_DATA_CODES.size}).`
  );
}

run();
