/**
 * Brain-tool wrappers for the document drafter.
 *
 * Registered via `setBrainExtraSkills(...)` in
 * `services/api-gateway/src/index.ts` after `buildServices()` so every
 * per-tenant Brain instance gains access to:
 *
 *   - skill.docs.draft_contract
 *   - skill.docs.draft_rfp
 *   - skill.docs.draft_rfp_response
 *   - skill.docs.draft_letter
 *   - skill.docs.revise_draft
 *
 * Each tool resolves `context.tenant.tenantId` + `context.actor.id` on
 * every invocation, so a single drafter instance is safe across
 * tenants — RLS at the database layer is the second line of defence.
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import type { DraftKind, DraftLanguage } from '@borjie/database';
import {
  createDocumentDrafter,
  type DraftPersistence,
  type SemanticBlockGenerator,
} from './index.js';

export interface BrainToolDeps {
  readonly persistence: DraftPersistence;
  readonly defaultGenerator?: SemanticBlockGenerator;
}

interface DraftPreview {
  readonly draftId: string;
  readonly contentPreview: string;
  readonly revisionCount: number;
  readonly status: string;
  readonly templateSlug: string;
}

function previewOf(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 600) return trimmed;
  return `${trimmed.slice(0, 600)}\n…\n[${trimmed.length - 600} more chars]`;
}

function pickLanguage(input: unknown): DraftLanguage {
  if (input === 'sw' || input === 'en' || input === 'bilingual') return input;
  return 'sw';
}

/**
 * Build the full set of document-drafter tool handlers.
 */
export function buildDocumentDrafterTools(
  deps: BrainToolDeps,
): readonly ToolHandler[] {
  const drafter = createDocumentDrafter({
    persistence: deps.persistence,
    defaultGenerator: deps.defaultGenerator,
  });

  // ----- shared helpers ----------------------------------------------------
  function requireString(v: unknown, name: string): string {
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new Error(`missing or empty parameter "${name}"`);
    }
    return v;
  }

  // ---------------------------------------------------------------------
  // draft_contract — supply-ore / equipment-lease / transport
  // ---------------------------------------------------------------------
  const draftContract: ToolHandler = {
    name: 'skill.docs.draft_contract',
    description:
      'Draft a mining contract (ore supply, equipment lease, or transport) bilingually (Swahili-first). Returns the draft id and a preview for review.',
    parameters: {
      type: 'object',
      required: ['kind', 'parties', 'terms'],
      properties: {
        kind: {
          type: 'string',
          enum: ['supply-ore', 'equipment-lease', 'transport'],
          description: 'Which contract template to use.',
        },
        parties: {
          type: 'object',
          description: 'Counterparty data (names, addresses, registration).',
        },
        terms: {
          type: 'object',
          description:
            'Commercial terms — prices, quantities, dates, payment method.',
        },
        currency: {
          type: 'string',
          description: 'Currency code (e.g. TZS, USD, KES).',
        },
        titleSw: { type: 'string' },
        titleEn: { type: 'string' },
        language: { type: 'string', enum: ['sw', 'en', 'bilingual'] },
        jurisdiction: { type: 'string' },
      },
    },
    async execute(params, context) {
      try {
        const kind = requireString(params['kind'], 'kind');
        const slug = `contract.${kind}`;
        const language = pickLanguage(params['language']);
        const parties =
          (params['parties'] as Record<string, unknown> | undefined) ?? {};
        const terms =
          (params['terms'] as Record<string, unknown> | undefined) ?? {};
        const currency =
          typeof params['currency'] === 'string'
            ? (params['currency'] as string)
            : 'TZS';
        const fillVars: Record<string, unknown> = {
          ...parties,
          ...terms,
          currency,
        };
        const titleSw =
          (typeof params['titleSw'] === 'string' && (params['titleSw'] as string)) ||
          `Mkataba wa ${kind}`;
        const draft = await drafter.composeDraft({
          tenantId: context.tenant.tenantId,
          userId: context.actor.id,
          kind: 'contract',
          templateSlug: slug,
          language,
          titleSw,
          titleEn:
            typeof params['titleEn'] === 'string'
              ? (params['titleEn'] as string)
              : undefined,
          jurisdiction:
            typeof params['jurisdiction'] === 'string'
              ? (params['jurisdiction'] as string)
              : undefined,
          fillVars,
        });
        const data: DraftPreview = {
          draftId: draft.id,
          contentPreview: previewOf(draft.contentMd),
          revisionCount: draft.revisionCount,
          status: draft.status,
          templateSlug: draft.sourceTemplateSlug,
        };
        return {
          ok: true,
          data,
          evidenceSummary: `Drafted ${slug} v1 for tenant ${context.tenant.tenantId}`,
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  };

  // ---------------------------------------------------------------------
  // draft_rfp — equipment-purchase / smelter-services
  // ---------------------------------------------------------------------
  const draftRfp: ToolHandler = {
    name: 'skill.docs.draft_rfp',
    description:
      'Draft a Request for Proposal (equipment purchase or smelter services). Bilingual, Tanzania-default jurisdiction.',
    parameters: {
      type: 'object',
      required: ['purpose', 'requirements', 'deadline'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['equipment-purchase', 'smelter-services'],
        },
        requirements: { type: 'object' },
        deadline: { type: 'string' },
        rfpNumber: { type: 'string' },
        titleSw: { type: 'string' },
        titleEn: { type: 'string' },
        language: { type: 'string', enum: ['sw', 'en', 'bilingual'] },
      },
    },
    async execute(params, context) {
      try {
        const purpose = requireString(params['purpose'], 'purpose');
        const slug = `rfp.${purpose}`;
        const language = pickLanguage(params['language']);
        const requirements =
          (params['requirements'] as Record<string, unknown> | undefined) ?? {};
        const fillVars: Record<string, unknown> = {
          ...requirements,
          submissionDeadline: requireString(params['deadline'], 'deadline'),
          rfpNumber:
            (typeof params['rfpNumber'] === 'string' && (params['rfpNumber'] as string)) ||
            `RFP-${Date.now()}`,
          issueDate: new Date().toISOString().slice(0, 10),
          tenantName: context.tenant.tenantName,
        };
        const titleSw =
          (typeof params['titleSw'] === 'string' && (params['titleSw'] as string)) ||
          `Ombi la Tume — ${purpose}`;
        const draft = await drafter.composeDraft({
          tenantId: context.tenant.tenantId,
          userId: context.actor.id,
          kind: 'rfp',
          templateSlug: slug,
          language,
          titleSw,
          titleEn:
            typeof params['titleEn'] === 'string'
              ? (params['titleEn'] as string)
              : undefined,
          fillVars,
        });
        const data: DraftPreview = {
          draftId: draft.id,
          contentPreview: previewOf(draft.contentMd),
          revisionCount: draft.revisionCount,
          status: draft.status,
          templateSlug: draft.sourceTemplateSlug,
        };
        return {
          ok: true,
          data,
          evidenceSummary: `Drafted RFP ${slug} for tenant ${context.tenant.tenantId}`,
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  };

  // ---------------------------------------------------------------------
  // draft_rfp_response
  // ---------------------------------------------------------------------
  const draftRfpResponse: ToolHandler = {
    name: 'skill.docs.draft_rfp_response',
    description:
      'Draft a structured RFP response (cover letter + technical + commercial + compliance matrix).',
    parameters: {
      type: 'object',
      required: ['rfpDocumentId', 'ourPosition', 'pricing'],
      properties: {
        rfpDocumentId: { type: 'string' },
        ourPosition: { type: 'object' },
        pricing: { type: 'object' },
        titleSw: { type: 'string' },
        titleEn: { type: 'string' },
        language: { type: 'string', enum: ['sw', 'en', 'bilingual'] },
      },
    },
    async execute(params, context) {
      try {
        const rfpDocId = requireString(params['rfpDocumentId'], 'rfpDocumentId');
        const language = pickLanguage(params['language']);
        const ourPosition =
          (params['ourPosition'] as Record<string, unknown> | undefined) ?? {};
        const pricing =
          (params['pricing'] as Record<string, unknown> | undefined) ?? {};
        const fillVars: Record<string, unknown> = {
          ...ourPosition,
          ...pricing,
          rfpNumber: rfpDocId,
          responseDate: new Date().toISOString().slice(0, 10),
          tenantName: context.tenant.tenantName,
        };
        const titleSw =
          (typeof params['titleSw'] === 'string' && (params['titleSw'] as string)) ||
          `Jibu la RFP ${rfpDocId}`;
        const draft = await drafter.composeDraft({
          tenantId: context.tenant.tenantId,
          userId: context.actor.id,
          kind: 'rfp_response',
          templateSlug: 'rfp_response.template',
          language,
          titleSw,
          titleEn:
            typeof params['titleEn'] === 'string'
              ? (params['titleEn'] as string)
              : undefined,
          fillVars,
        });
        const data: DraftPreview = {
          draftId: draft.id,
          contentPreview: previewOf(draft.contentMd),
          revisionCount: draft.revisionCount,
          status: draft.status,
          templateSlug: draft.sourceTemplateSlug,
        };
        return {
          ok: true,
          data,
          evidenceSummary: `Drafted RFP response to ${rfpDocId} for tenant ${context.tenant.tenantId}`,
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  };

  // ---------------------------------------------------------------------
  // draft_letter
  // ---------------------------------------------------------------------
  const draftLetter: ToolHandler = {
    name: 'skill.docs.draft_letter',
    description:
      'Draft a formal letter (regulator: TUMEMADINI / NEMC / BoT; community grievance response).',
    parameters: {
      type: 'object',
      required: ['recipient', 'subject', 'intent'],
      properties: {
        recipient: {
          type: 'string',
          enum: ['tumemadini', 'nemc', 'bot', 'community-grievance'],
        },
        subject: { type: 'string' },
        intent: { type: 'object' },
        tone: {
          type: 'string',
          enum: ['neutral', 'formal', 'conciliatory', 'firm'],
        },
        titleSw: { type: 'string' },
        titleEn: { type: 'string' },
        language: { type: 'string', enum: ['sw', 'en', 'bilingual'] },
      },
    },
    async execute(params, context) {
      try {
        const recipient = requireString(params['recipient'], 'recipient');
        const subject = requireString(params['subject'], 'subject');
        const slug =
          recipient === 'community-grievance'
            ? 'letter.community-grievance'
            : `letter.${recipient === 'bot' ? 'bank.bot' : `regulator.${recipient}`}`;
        const language = pickLanguage(params['language']);
        const intent =
          (params['intent'] as Record<string, unknown> | undefined) ?? {};
        const fillVars: Record<string, unknown> = {
          ...intent,
          letterDate: new Date().toISOString().slice(0, 10),
          letterSubject: subject,
          tenantName: context.tenant.tenantName,
        };
        const titleSw =
          (typeof params['titleSw'] === 'string' && (params['titleSw'] as string)) ||
          `Barua: ${subject}`;
        const draft = await drafter.composeDraft({
          tenantId: context.tenant.tenantId,
          userId: context.actor.id,
          kind: 'letter',
          templateSlug: slug,
          language,
          titleSw,
          titleEn:
            typeof params['titleEn'] === 'string'
              ? (params['titleEn'] as string)
              : undefined,
          fillVars,
        });
        const data: DraftPreview = {
          draftId: draft.id,
          contentPreview: previewOf(draft.contentMd),
          revisionCount: draft.revisionCount,
          status: draft.status,
          templateSlug: draft.sourceTemplateSlug,
        };
        return {
          ok: true,
          data,
          evidenceSummary: `Drafted letter "${subject}" to ${recipient} for tenant ${context.tenant.tenantId}`,
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  };

  // ---------------------------------------------------------------------
  // revise_draft
  // ---------------------------------------------------------------------
  const reviseDraftTool: ToolHandler = {
    name: 'skill.docs.revise_draft',
    description:
      'Produce a new revision of an existing draft by applying a free-form revision instruction. Chains via parent_draft_id.',
    parameters: {
      type: 'object',
      required: ['draftId', 'revisionInstruction'],
      properties: {
        draftId: { type: 'string' },
        revisionInstruction: { type: 'string' },
      },
    },
    async execute(params, context) {
      try {
        const draftId = requireString(params['draftId'], 'draftId');
        const instruction = requireString(
          params['revisionInstruction'],
          'revisionInstruction',
        );
        const revised = await drafter.reviseDraft({
          tenantId: context.tenant.tenantId,
          draftId,
          instruction,
        });
        const data: DraftPreview = {
          draftId: revised.id,
          contentPreview: previewOf(revised.contentMd),
          revisionCount: revised.revisionCount,
          status: revised.status,
          templateSlug: revised.sourceTemplateSlug,
        };
        return {
          ok: true,
          data,
          evidenceSummary: `Revised draft (parent=${draftId}) → revision v${revised.revisionCount}`,
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
  };

  return [
    draftContract,
    draftRfp,
    draftRfpResponse,
    draftLetter,
    reviseDraftTool,
  ];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-export so callers can hold onto the DraftKind list and not have
// to import from @borjie/database in their wiring code.
export type { DraftKind, DraftLanguage };
