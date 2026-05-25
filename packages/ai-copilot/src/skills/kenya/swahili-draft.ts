/**
 * Swahili / Code-Switch Draft Skill
 *
 * A lightweight, opinionated template-based drafter for common tenant-facing
 * communications in Swahili, English, or code-switched Sheng. Used by the
 * Communications Junior and Coworker when drafting notices.
 *
 * We deliberately ship templates here rather than relying on pure LLM
 * translation. Why:
 *  - Deterministic. Legal notices need stable, reviewable language.
 *  - Fast. No LLM call in the common path.
 *  - Auditable. Templates are versioned.
 *
 * For free-form messages outside these templates, the calling persona uses
 * its own LLM turn with the Conversational Personalization service — this
 * skill just handles the structured notices.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const LocaleSchema = z.enum(['en', 'sw', 'sheng']);
export type Locale = z.infer<typeof LocaleSchema>;

export const NoticeKindSchema = z.enum([
  'rent_reminder_gentle',
  'rent_reminder_firm',
  'service_charge_notice',
  'maintenance_visit',
  'water_outage',
  'power_outage',
  'move_out_inspection',
  'lease_renewal_invitation',
]);
export type NoticeKind = z.infer<typeof NoticeKindSchema>;

export const SwahiliDraftParamsSchema = z.object({
  kind: NoticeKindSchema,
  locale: LocaleSchema.default('sw'),
  tenantName: z.string().default('Mpangaji'),
  unitLabel: z.string().optional(),
  amountKes: z.number().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  reason: z.string().optional(),
  propertyName: z.string().optional(),
});
export type SwahiliDraftParams = z.infer<typeof SwahiliDraftParamsSchema>;

interface Template {
  subject: string;
  body: string;
}

/**
 * Very carefully written — these are production tenant-facing strings.
 * Reviewed for tone (Swahili "heshima" / respect is the default).
 * Code-switching in Sheng is kept professional, not slangy.
 */
const TEMPLATES: Record<NoticeKind, Record<Locale, Template>> = {
  rent_reminder_gentle: {
    sw: {
      subject: 'Kumbusho la Kodi — {unitLabel}',
      body:
        'Habari {tenantName},\n\n' +
        'Tafadhali kumbuka kuwa kodi ya {unitLabel} ya KES {amountKes} inafaa kulipwa kufikia {date}. ' +
        'Ikiwa tayari umelipa, asante sana — puuza ujumbe huu.\n\n' +
        'Kwa malipo: tumia paybill kama kawaida na jina la akaunti {unitLabel}.\n\n' +
        'Asante,\nTimu ya {propertyName}',
    },
    en: {
      subject: 'Rent Reminder — {unitLabel}',
      body:
        'Hello {tenantName},\n\n' +
        'A gentle reminder that rent for {unitLabel} of KES {amountKes} is due on {date}. ' +
        'If you have already paid, please disregard this message.\n\n' +
        'For payment, use the usual paybill with account {unitLabel}.\n\n' +
        'Thank you,\n{propertyName} Team',
    },
    sheng: {
      subject: 'Kumbusho Rent — {unitLabel}',
      body:
        'Hi {tenantName}, hii ni kumbusho ya rent ya {unitLabel} — KES {amountKes} inatakiwa kwa {date}. ' +
        'Kama umeshalipa, asante, ignore hii msg.\n\nTumia paybill na account {unitLabel}.\n\nAsante,\n{propertyName}',
    },
  },
  rent_reminder_firm: {
    sw: {
      subject: 'Ombi la Haraka: Kodi ya {unitLabel}',
      body:
        'Habari {tenantName},\n\nRekodi zetu zinaonyesha kuwa kodi ya {unitLabel} ya KES {amountKes} bado haijalipwa tangu {date}. ' +
        'Tafadhali lipa au wasiliana nasi mara moja ili tupate mpango wa malipo.\n\nAsante,\n{propertyName}',
    },
    en: {
      subject: 'Urgent: Outstanding Rent for {unitLabel}',
      body:
        'Hello {tenantName},\n\nOur records show that rent for {unitLabel} of KES {amountKes} has been outstanding since {date}. ' +
        'Please settle or contact us immediately to arrange a payment plan.\n\nRegards,\n{propertyName}',
    },
    sheng: {
      subject: 'Urgent: Rent {unitLabel}',
      body:
        'Hi {tenantName}, tuna-note ya rent ya {unitLabel} (KES {amountKes}) bado haija-come tangu {date}. ' +
        'Tafadhali malizia ama tupigie tu-arrange plan.\n\n{propertyName}',
    },
  },
  service_charge_notice: {
    sw: {
      subject: 'Ankara ya Service Charge — {propertyName}',
      body:
        'Habari {tenantName},\n\nAnkara ya service charge kwa mwezi huu ni KES {amountKes} kwa {unitLabel}. ' +
        'Kiasi hiki kinagharamia usafi, ulinzi, na matengenezo ya maeneo ya pamoja. ' +
        'Tafadhali lipa kufikia {date}.\n\nAsante,\n{propertyName}',
    },
    en: {
      subject: 'Service Charge Invoice — {propertyName}',
      body:
        'Hello {tenantName},\n\nThis month\'s service charge is KES {amountKes} for {unitLabel}. ' +
        'It covers cleaning, security, and common-area maintenance. Kindly settle by {date}.\n\nThank you,\n{propertyName}',
    },
    sheng: {
      subject: 'Service Charge — {unitLabel}',
      body:
        'Hi {tenantName}, service charge ya this month ni KES {amountKes} ya {unitLabel}. ' +
        'Inacover cleaning, security, na common areas. Lipa kabla ya {date}.\n\n{propertyName}',
    },
  },
  maintenance_visit: {
    sw: {
      subject: 'Matengenezo: {unitLabel} tarehe {date}',
      body:
        'Habari {tenantName},\n\nTutatembelea {unitLabel} tarehe {date} saa {time} kwa ajili ya {reason}. ' +
        'Tafadhali hakikisha mtu yuko ndani au tuambie saa zinazokufaa.\n\nAsante,\n{propertyName}',
    },
    en: {
      subject: 'Maintenance Visit: {unitLabel} on {date}',
      body:
        'Hello {tenantName},\n\nWe will visit {unitLabel} on {date} at {time} for {reason}. ' +
        'Please ensure someone is home or let us know a better time.\n\nRegards,\n{propertyName}',
    },
    sheng: {
      subject: 'Maintenance visit — {unitLabel}',
      body:
        'Hi {tenantName}, tuta-pita {unitLabel} {date} saa {time} kwa {reason}. ' +
        'Hakikisha kuna mtu ama utu-tell time ingine nzuri.\n\n{propertyName}',
    },
  },
  water_outage: {
    sw: {
      subject: 'Tahadhari: Ukosefu wa Maji — {propertyName}',
      body:
        'Habari wapangaji,\n\nKutakuwa na ukosefu wa maji {date} kuanzia saa {time}. ' +
        'Sababu: {reason}. Tafadhali jitayarishe kwa kuhifadhi maji kabla. ' +
        'Tutarejesha huduma haraka iwezekanavyo.\n\n{propertyName}',
    },
    en: {
      subject: 'Notice: Water Interruption — {propertyName}',
      body:
        'Dear tenants,\n\nThere will be a water interruption on {date} from {time}. ' +
        'Reason: {reason}. Please store water in advance. Service will resume as soon as possible.\n\n{propertyName}',
    },
    sheng: {
      subject: 'Water outage — {propertyName}',
      body:
        'Hi wapangaji, maji hazitakuwepo {date} from saa {time} ({reason}). Jaza madebe mapema. Tutarudisha asap.\n\n{propertyName}',
    },
  },
  power_outage: {
    sw: {
      subject: 'Tahadhari: Ukosefu wa Umeme — {propertyName}',
      body:
        'Habari wapangaji,\n\nKutakuwa na ukosefu wa umeme {date} kuanzia saa {time}. ' +
        'Sababu: {reason}. Backup generator itaendesha huduma muhimu pekee.\n\n{propertyName}',
    },
    en: {
      subject: 'Notice: Power Interruption — {propertyName}',
      body:
        'Dear tenants,\n\nPower will be interrupted on {date} from {time}. Reason: {reason}. ' +
        'Backup generator will run essential services only.\n\n{propertyName}',
    },
    sheng: {
      subject: 'Power outage — {propertyName}',
      body:
        'Hi wapangaji, power itazima {date} from saa {time} ({reason}). Backup itarun essentials tu.\n\n{propertyName}',
    },
  },
  move_out_inspection: {
    sw: {
      subject: 'Ukaguzi wa Kuhama — {unitLabel}',
      body:
        'Habari {tenantName},\n\nTumepanga ukaguzi wa kuhama kwa {unitLabel} tarehe {date} saa {time}. ' +
        'Tafadhali hakikisha nyumba ni safi na ufunguo uko tayari kukabidhiwa. ' +
        'Marejesho ya amana yatafanywa ndani ya siku 14 baada ya ukaguzi.\n\n{propertyName}',
    },
    en: {
      subject: 'Move-Out Inspection — {unitLabel}',
      body:
        'Hello {tenantName},\n\nWe have scheduled your move-out inspection for {unitLabel} on {date} at {time}. ' +
        'Please ensure the unit is clean and keys are ready for handover. ' +
        'Deposit refund will be processed within 14 days of inspection.\n\n{propertyName}',
    },
    sheng: {
      subject: 'Move-out inspection — {unitLabel}',
      body:
        'Hi {tenantName}, tumeset move-out inspection ya {unitLabel} {date} saa {time}. ' +
        'Unit iwe clean, keys ziwe ready. Deposit refund ndani ya 14 days.\n\n{propertyName}',
    },
  },
  lease_renewal_invitation: {
    sw: {
      subject: 'Mwaliko: Kuendeleza Mkataba wa {unitLabel}',
      body:
        'Habari {tenantName},\n\nMkataba wako wa {unitLabel} unamalizika {date}. Tunafurahi kukualika ' +
        'kuendeleza mkataba. Tafadhali wasiliana nasi kujadili masharti mapya.\n\nAsante,\n{propertyName}',
    },
    en: {
      subject: 'Invitation to Renew Your Lease — {unitLabel}',
      body:
        'Hello {tenantName},\n\nYour lease for {unitLabel} ends on {date}. We would like to invite you ' +
        'to renew. Please reach out so we can discuss new terms.\n\nRegards,\n{propertyName}',
    },
    sheng: {
      subject: 'Lease renewal — {unitLabel}',
      body:
        'Hi {tenantName}, lease yako ya {unitLabel} inaisha {date}. Tungependa kurenew. Tupigie tujadili terms mpya.\n\n{propertyName}',
    },
  },
};

function interpolate(tpl: string, params: SwahiliDraftParams): string {
  return tpl
    .replaceAll('{tenantName}', params.tenantName)
    .replaceAll('{unitLabel}', params.unitLabel ?? 'nyumba yako')
    .replaceAll(
      '{amountKes}',
      params.amountKes !== undefined
        ? params.amountKes.toLocaleString('en-KE')
        : '—'
    )
    .replaceAll('{date}', params.date ?? '[tarehe]')
    .replaceAll('{time}', params.time ?? '[saa]')
    .replaceAll('{reason}', params.reason ?? '[sababu]')
    .replaceAll('{propertyName}', params.propertyName ?? 'Borjie');
}

export interface SwahiliDraftResult {
  locale: Locale;
  kind: NoticeKind;
  subject: string;
  body: string;
}

export function draftNotice(params: SwahiliDraftParams): SwahiliDraftResult {
  const t = TEMPLATES[params.kind][params.locale];
  return {
    locale: params.locale,
    kind: params.kind,
    subject: interpolate(t.subject, params),
    body: interpolate(t.body, params),
  };
}

export const swahiliDraftTool: ToolHandler = {
  name: 'skill.kenya.swahili_draft',
  description:
    'Draft a tenant-facing notice from a small set of templates in Swahili, English, or code-switched Sheng. Used by the Communications Junior and Coworker for routine notices.',
  parameters: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: {
        type: 'string',
        enum: [
          'rent_reminder_gentle',
          'rent_reminder_firm',
          'service_charge_notice',
          'maintenance_visit',
          'water_outage',
          'power_outage',
          'move_out_inspection',
          'lease_renewal_invitation',
        ],
      },
      locale: { type: 'string', enum: ['en', 'sw', 'sheng'], default: 'sw' },
      tenantName: { type: 'string' },
      unitLabel: { type: 'string' },
      amountKes: { type: 'number' },
      date: { type: 'string' },
      time: { type: 'string' },
      reason: { type: 'string' },
      propertyName: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = SwahiliDraftParamsSchema.safeParse(params);
    if (!parsed.success)
      return { ok: false, error: `invalid params: ${parsed.error.message}` };
    const result = draftNotice(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Drafted ${result.kind} in ${result.locale}: "${result.subject}"`,
    };
  },
};
