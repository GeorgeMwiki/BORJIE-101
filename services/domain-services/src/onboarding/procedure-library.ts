/**
 * Procedure Library - SOP-level training content
 * Workflow A.2 per BORJIE_SPEC.md
 * Supports English and Swahili
 */

import type { ProcedureId } from './types.js';
import { asProcedureId } from './types.js';

export interface ProcedureStep {
  readonly en: string;
  readonly sw: string;
}

export interface Procedure {
  readonly id: ProcedureId;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  readonly steps: readonly ProcedureStep[];
  readonly comprehensionCheckEn: string;
  readonly comprehensionCheckSw: string;
  readonly order: number;
}

// ============================================================================
// Procedure IDs
// ============================================================================

export const PROCEDURE_IDS = {
  TANESCO_LUKU_TOKENS: 'proc_tanesco_luku_tokens',
  REQUEST_MAINTENANCE: 'proc_request_maintenance',
  EMERGENCY_CONTACTS: 'proc_emergency_contacts',
  HOUSE_RULES: 'proc_house_rules',
} as const;

// ============================================================================
// Procedure Library
// ============================================================================

export const PROCEDURE_LIBRARY: readonly Procedure[] = [
  {
    id: asProcedureId(PROCEDURE_IDS.TANESCO_LUKU_TOKENS),
    titleEn: 'How to load TANESCO/LUKU tokens',
    titleSw: 'Jinsi ya kuongeza vitengo vya umeme TANESCO/LUKU',
    descriptionEn:
      'This guide explains how to add electricity units to your prepaid meter (TANESCO/LUKU).',
    descriptionSw:
      'Mwongozo huu unaeleza jinsi ya kuongeza vitengo vya umeme kwenye mita yako ya prepaid (TANESCO/LUKU).',
    steps: [
      {
        en: 'First, identify your meter type: Is it a keypad meter inside your unit, or a shared meter outside?',
        sw: 'Kwanza, tambua aina ya mita yako: Je, ni mita yenye kibaodi ndani ya chumba chako, au mita ya pamoja nje?',
      },
      {
        en: 'Locate your meter number (usually printed on the meter or on your bill).',
        sw: 'Tafuta nambari ya mita yako (kawaida inachapishwa kwenye mita au bili yako).',
      },
      {
        en: 'Purchase a 20-digit token from TANESCO, LUKU agent, or authorized vendor (e.g., M-Pesa, mobile banking).',
        sw: 'Nunua tokeni yenye tarakimu 20 kutoka TANESCO, wakala wa LUKU, au muuzaji halali (mfano: M-Pesa, benki ya simu).',
      },
      {
        en: 'On the keypad meter: Press the "Enter" or "OK" button, then carefully enter all 20 digits.',
        sw: 'Kwenye mita ya kibaodi: Bonyeza kitufe cha "Enter" au "OK", kisha ingiza tarakimu 20 kwa makini.',
      },
      {
        en: 'Confirm the acceptance message or unit update displayed on the meter.',
        sw: 'Thibitisha ujumbe wa kukubaliwa au sasisho la vitengo linaloonyeshwa kwenye mita.',
      },
      {
        en: 'If rejected: Check for wrong token, already-used token, or meter battery/connection issues. For self-service retrieval, use the official TANESCO 150 menu flow or published steps.',
        sw: 'Ikiwa imekataliwa: Angalia tokeni mbaya, tokeni iliyotumika tayari, au matatizo ya betri/kushikamana kwa mita. Kwa kuhudumu kwa kujisaidia, tumia meni rasmi ya 150 ya TANESCO au hatua zilizochapishwa.',
      },
    ],
    comprehensionCheckEn: 'Reply 1 to confirm you understood how to load tokens.',
    comprehensionCheckSw: 'Jibu 1 kuthibitisha umeelewa jinsi ya kuongeza vitengo.',
    order: 1,
  },
  {
    id: asProcedureId(PROCEDURE_IDS.REQUEST_MAINTENANCE),
    titleEn: 'How to request maintenance',
    titleSw: 'Jinsi ya kuomba matengenezo',
    descriptionEn:
      'This guide explains how to report repairs and request maintenance for your unit.',
    descriptionSw:
      'Mwongozo huu unaeleza jinsi ya kuripoti matengenezo na kuomba matengenezo kwa chumba chako.',
    steps: [
      {
        en: 'Contact us via WhatsApp, the app, SMS, or email (use your preferred channel).',
        sw: 'Wasiliana nasi kupitia WhatsApp, programu, SMS, au barua pepe (tumia njia unayopendelea).',
      },
      {
        en: 'Describe the issue clearly: location (e.g., kitchen sink), type (e.g., leak), and when it started.',
        sw: 'Eleza tatizo kwa wazi: eneo (mfano, sinki ya jikoni), aina (mfano, kuvuja), na lilianza lini.',
      },
      {
        en: 'Send photos or a short video if possible—this helps us fix it faster.',
        sw: 'Tuma picha au video fupi ikiwezekana—hii inasaidia kurekebisha haraka.',
      },
      {
        en: 'You will receive a confirmation and an estimated time for the technician visit.',
        sw: 'Utapokea uthibitishaji na muda unaotarajiwa wa ziara ya fundi.',
      },
      {
        en: 'After the visit, confirm that the issue is resolved.',
        sw: 'Baada ya ziara, thibitisha kuwa tatizo limetatuliwa.',
      },
    ],
    comprehensionCheckEn: 'Reply 1 to confirm you understood how to request maintenance.',
    comprehensionCheckSw: 'Jibu 1 kuthibitisha umeelewa jinsi ya kuomba matengenezo.',
    order: 2,
  },
  {
    id: asProcedureId(PROCEDURE_IDS.EMERGENCY_CONTACTS),
    titleEn: 'Emergency contacts and procedures',
    titleSw: 'Mawasiliano ya dharura na taratibu',
    descriptionEn:
      'Important contacts and what to do in case of fire, flood, break-in, or other emergencies.',
    descriptionSw:
      'Mawasiliano muhimu na cha kufanya katika tukio la moto, mafuriko, uvamizi, au dharura zingine.',
    steps: [
      {
        en: 'Fire: Evacuate immediately. Call fire brigade (114) and notify estate manager. Do not use elevators.',
        sw: 'Moto: Ondoka mara moja. Piga kikosi cha zimamoto (114) na wajulishi msimamizi wa nyumba. Usitumie lifti.',
      },
      {
        en: 'Flood/Gas leak: Switch off main water/gas if safe. Notify manager and security.',
        sw: 'Mafuriko/Ukosefu wa gesi: Zima maji/gesi kuu ikiwa salama. Wajulishi msimamizi na usalama.',
      },
      {
        en: 'Break-in or security threat: Call police (112) and notify estate security immediately.',
        sw: 'Uvamizi au tishio la usalama: Piga polisi (112) na wajulishi usalama wa nyumba mara moja.',
      },
      {
        en: 'Electrical sparks or shock: Do not touch. Switch off main power if safe. Notify manager and avoid water.',
        sw: 'Taa za umeme au mshtuko: Usiguse. Zima umeme kuu ikiwa salama. Wajulishi msimamizi na epuka maji.',
      },
      {
        en: 'Save these numbers: Estate Manager, Security, Police (112), Fire (114), Ambulance (115).',
        sw: 'Hifadhi nambari hizi: Msimamizi wa Nyumba, Usalama, Polisi (112), Moto (114), Ambulensi (115).',
      },
    ],
    comprehensionCheckEn: 'Reply 1 to confirm you understood emergency procedures.',
    comprehensionCheckSw: 'Jibu 1 kuthibitisha umeelewa taratibu za dharura.',
    order: 3,
  },
  {
    id: asProcedureId(PROCEDURE_IDS.HOUSE_RULES),
    titleEn: 'House rules and policies',
    titleSw: 'Sheria za nyumba na sera',
    descriptionEn:
      'General rules for noise, pets, visitors, parking, trash, and property care.',
    descriptionSw:
      'Sheria za jumla kuhusu kelele, wanyama, wageni, maegesho, taka, na utunzaji wa mali.',
    steps: [
      {
        en: 'Quiet hours: Respect quiet hours (typically 10pm–6am). Avoid loud music or noise.',
        sw: 'Saa za utulivu: Hebu heshima saa za utulivu (kawaida 10pm–6am). Epuka muziki wa sauti kubwa au kelele.',
      },
      {
        en: 'Pets: Check if pets are allowed. If yes, follow registration and cleanup rules.',
        sw: 'Wanyama: Angalia ikiwa wanyama waruhusiwa. Ikiwa ndiyo, fuata sheria za usajili na usafishaji.',
      },
      {
        en: 'Visitors: Report overnight guests if required. Ensure visitors follow building rules.',
        sw: 'Wageni: Ripoti wageni wa usiku ikiwa inahitajika. Hakikisha wageni wanafuata sheria za jengo.',
      },
      {
        en: 'Parking: Use assigned spaces only. Do not block emergency access.',
        sw: 'Maegesho: Tumia nafasi zilizotengwa tu. Usizibie njia za dharura.',
      },
      {
        en: 'Trash: Dispose in designated bins. Follow recycling and collection schedules.',
        sw: 'Taka: Tupa kwenye maboxi yaliyotengwa. Fuata ratiba za kuchakata na kukusanya.',
      },
      {
        en: 'General care: Report damage promptly. Do not make structural changes without approval.',
        sw: 'Utunzaji wa jumla: Ripoti uharibifu haraka. Usifanye mabadiliko ya muundo bila idhini.',
      },
    ],
    comprehensionCheckEn: 'Reply 1 to confirm you understood house rules.',
    comprehensionCheckSw: 'Jibu 1 kuthibitisha umeelewa sheria za nyumba.',
    order: 4,
  },
] as const;

/** Get procedure by ID */
export function getProcedure(id: ProcedureId): Procedure | undefined {
  return PROCEDURE_LIBRARY.find((p) => p.id === id);
}

/** Get all procedures in order */
export function getAllProcedures(): readonly Procedure[] {
  return [...PROCEDURE_LIBRARY].sort((a, b) => a.order - b.order);
}
