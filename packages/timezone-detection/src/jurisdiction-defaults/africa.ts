/**
 * Default timezone for every African ISO-3166-1 alpha-2 jurisdiction (54).
 *
 * Source: IANA Time Zone Database (tzdata 2024b+), entries keyed by the
 * capital-city zone. Africa is single-zone for almost every country —
 * the only multi-zone members are DR Congo (CD: Kinshasa + Lubumbashi).
 *
 * Africa does NOT observe DST anywhere as of 2026 — Morocco's
 * year-round +01 sits on `Africa/Casablanca` and Egypt re-suspended its
 * 2023 reinstatement, so all observesDST flags here are `false`.
 */

import type { JurisdictionDefault } from '../types.js';

export const AFRICA_DEFAULTS: ReadonlyArray<JurisdictionDefault> = [
  { jurisdiction: 'DZ', timezone: 'Africa/Algiers', canonicalCity: 'Algiers', isMultiZone: false, observesDST: false },
  { jurisdiction: 'AO', timezone: 'Africa/Luanda', canonicalCity: 'Luanda', isMultiZone: false, observesDST: false },
  { jurisdiction: 'BJ', timezone: 'Africa/Porto-Novo', canonicalCity: 'Porto-Novo', isMultiZone: false, observesDST: false },
  { jurisdiction: 'BW', timezone: 'Africa/Gaborone', canonicalCity: 'Gaborone', isMultiZone: false, observesDST: false },
  { jurisdiction: 'BF', timezone: 'Africa/Ouagadougou', canonicalCity: 'Ouagadougou', isMultiZone: false, observesDST: false },
  { jurisdiction: 'BI', timezone: 'Africa/Bujumbura', canonicalCity: 'Bujumbura', isMultiZone: false, observesDST: false },
  { jurisdiction: 'CV', timezone: 'Atlantic/Cape_Verde', canonicalCity: 'Praia', isMultiZone: false, observesDST: false },
  { jurisdiction: 'CM', timezone: 'Africa/Douala', canonicalCity: 'Yaounde', isMultiZone: false, observesDST: false },
  { jurisdiction: 'CF', timezone: 'Africa/Bangui', canonicalCity: 'Bangui', isMultiZone: false, observesDST: false },
  { jurisdiction: 'TD', timezone: 'Africa/Ndjamena', canonicalCity: "N'Djamena", isMultiZone: false, observesDST: false },
  { jurisdiction: 'KM', timezone: 'Indian/Comoro', canonicalCity: 'Moroni', isMultiZone: false, observesDST: false },
  { jurisdiction: 'CG', timezone: 'Africa/Brazzaville', canonicalCity: 'Brazzaville', isMultiZone: false, observesDST: false },
  // DR Congo is split: Kinshasa (UTC+1) west, Lubumbashi (UTC+2) east.
  { jurisdiction: 'CD', timezone: 'Africa/Kinshasa', canonicalCity: 'Kinshasa', isMultiZone: true, observesDST: false },
  { jurisdiction: 'CI', timezone: 'Africa/Abidjan', canonicalCity: 'Yamoussoukro', isMultiZone: false, observesDST: false },
  { jurisdiction: 'DJ', timezone: 'Africa/Djibouti', canonicalCity: 'Djibouti', isMultiZone: false, observesDST: false },
  { jurisdiction: 'EG', timezone: 'Africa/Cairo', canonicalCity: 'Cairo', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GQ', timezone: 'Africa/Malabo', canonicalCity: 'Malabo', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ER', timezone: 'Africa/Asmara', canonicalCity: 'Asmara', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SZ', timezone: 'Africa/Mbabane', canonicalCity: 'Mbabane', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ET', timezone: 'Africa/Addis_Ababa', canonicalCity: 'Addis Ababa', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GA', timezone: 'Africa/Libreville', canonicalCity: 'Libreville', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GM', timezone: 'Africa/Banjul', canonicalCity: 'Banjul', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GH', timezone: 'Africa/Accra', canonicalCity: 'Accra', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GN', timezone: 'Africa/Conakry', canonicalCity: 'Conakry', isMultiZone: false, observesDST: false },
  { jurisdiction: 'GW', timezone: 'Africa/Bissau', canonicalCity: 'Bissau', isMultiZone: false, observesDST: false },
  { jurisdiction: 'KE', timezone: 'Africa/Nairobi', canonicalCity: 'Nairobi', isMultiZone: false, observesDST: false },
  { jurisdiction: 'LS', timezone: 'Africa/Maseru', canonicalCity: 'Maseru', isMultiZone: false, observesDST: false },
  { jurisdiction: 'LR', timezone: 'Africa/Monrovia', canonicalCity: 'Monrovia', isMultiZone: false, observesDST: false },
  { jurisdiction: 'LY', timezone: 'Africa/Tripoli', canonicalCity: 'Tripoli', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MG', timezone: 'Indian/Antananarivo', canonicalCity: 'Antananarivo', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MW', timezone: 'Africa/Blantyre', canonicalCity: 'Lilongwe', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ML', timezone: 'Africa/Bamako', canonicalCity: 'Bamako', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MR', timezone: 'Africa/Nouakchott', canonicalCity: 'Nouakchott', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MU', timezone: 'Indian/Mauritius', canonicalCity: 'Port Louis', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MA', timezone: 'Africa/Casablanca', canonicalCity: 'Rabat', isMultiZone: false, observesDST: false },
  { jurisdiction: 'MZ', timezone: 'Africa/Maputo', canonicalCity: 'Maputo', isMultiZone: false, observesDST: false },
  { jurisdiction: 'NA', timezone: 'Africa/Windhoek', canonicalCity: 'Windhoek', isMultiZone: false, observesDST: false },
  { jurisdiction: 'NE', timezone: 'Africa/Niamey', canonicalCity: 'Niamey', isMultiZone: false, observesDST: false },
  { jurisdiction: 'NG', timezone: 'Africa/Lagos', canonicalCity: 'Abuja', isMultiZone: false, observesDST: false },
  { jurisdiction: 'RW', timezone: 'Africa/Kigali', canonicalCity: 'Kigali', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ST', timezone: 'Africa/Sao_Tome', canonicalCity: 'Sao Tome', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SN', timezone: 'Africa/Dakar', canonicalCity: 'Dakar', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SC', timezone: 'Indian/Mahe', canonicalCity: 'Victoria', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SL', timezone: 'Africa/Freetown', canonicalCity: 'Freetown', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SO', timezone: 'Africa/Mogadishu', canonicalCity: 'Mogadishu', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ZA', timezone: 'Africa/Johannesburg', canonicalCity: 'Pretoria', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SS', timezone: 'Africa/Juba', canonicalCity: 'Juba', isMultiZone: false, observesDST: false },
  { jurisdiction: 'SD', timezone: 'Africa/Khartoum', canonicalCity: 'Khartoum', isMultiZone: false, observesDST: false },
  { jurisdiction: 'TZ', timezone: 'Africa/Dar_es_Salaam', canonicalCity: 'Dodoma', isMultiZone: false, observesDST: false },
  { jurisdiction: 'TG', timezone: 'Africa/Lome', canonicalCity: 'Lome', isMultiZone: false, observesDST: false },
  { jurisdiction: 'TN', timezone: 'Africa/Tunis', canonicalCity: 'Tunis', isMultiZone: false, observesDST: false },
  { jurisdiction: 'UG', timezone: 'Africa/Kampala', canonicalCity: 'Kampala', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ZM', timezone: 'Africa/Lusaka', canonicalCity: 'Lusaka', isMultiZone: false, observesDST: false },
  { jurisdiction: 'ZW', timezone: 'Africa/Harare', canonicalCity: 'Harare', isMultiZone: false, observesDST: false },
];
