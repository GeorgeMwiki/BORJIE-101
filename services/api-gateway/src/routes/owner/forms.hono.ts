/**
 * /api/v1/owner/forms — owner-cockpit "draft and fill" surface.
 *
 * Wave OWNER-OS. The owner asks the chat to draft a regulatory form
 * (royalty return, NEMC EIA cover letter, BoT gold-window-export
 * declaration, BRELA renewal). The cockpit dispatches here with a
 * template id and a payload of fill vars; this thin wrapper hands the
 * job to the existing document-drafter service
 * (`services/api-gateway/src/services/document-drafter/`) which writes
 * to `document_drafts` (migration 0084) and returns the persisted row.
 *
 * Owner-friendly template ids → drafter template slugs (registry in
 * `services/api-gateway/src/services/document-drafter/templates/`):
 *
 *   royalty-return       → letter.regulator.tumemadini  (royalty filing
 *                          template — the TUMEMADINI letter template
 *                          handles royalty submissions in current
 *                          jurisdiction).
 *   nemc-eia-cover       → letter.regulator.nemc
 *   bot-gold-export      → letter.bank.bot
 *   brela-renewal        → letter.regulator.tumemadini  (BRELA mining
 *                          renewal — same letter template family)
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope via
 *       `databaseMiddleware`'s GUC.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  createDocumentDrafter,
  createDrizzleDraftPersistence,
} from '../../services/document-drafter';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-forms');

const OWNER_TEMPLATE_IDS = [
  'royalty-return',
  'nemc-eia-cover',
  'bot-gold-export',
  'brela-renewal',
] as const;

type OwnerTemplateId = (typeof OWNER_TEMPLATE_IDS)[number];

const TEMPLATE_MAP: Record<
  OwnerTemplateId,
  { slug: string; kind: 'letter' | 'notice'; titleSw: string; titleEn: string }
> = {
  'royalty-return': {
    slug: 'letter.regulator.tumemadini',
    kind: 'letter',
    titleSw: 'Taarifa ya Mrabaha (TUMEMADINI)',
    titleEn: 'Royalty Return — Mining Commission (TUMEMADINI)',
  },
  'nemc-eia-cover': {
    slug: 'letter.regulator.nemc',
    kind: 'letter',
    titleSw: 'Barua ya Jalada — NEMC EIA',
    titleEn: 'NEMC EIA Cover Letter',
  },
  'bot-gold-export': {
    slug: 'letter.bank.bot',
    kind: 'letter',
    titleSw: 'Tamko la Mauzo ya Dhahabu — Benki Kuu',
    titleEn: 'BoT Gold-Window Export Declaration',
  },
  'brela-renewal': {
    slug: 'letter.regulator.tumemadini',
    kind: 'letter',
    titleSw: 'Maombi ya Kufanya Upya Leseni (BRELA / TUMEMADINI)',
    titleEn: 'BRELA Licence Renewal Request',
  },
};

const draftSchema = z.object({
  templateId: z.enum(OWNER_TEMPLATE_IDS),
  language: z.enum(['sw', 'en', 'bilingual']).default('en'),
  fillVars: z.record(z.string(), z.unknown()).default({}),
  jurisdiction: z.string().max(8).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.post('/draft', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: { code: 'OWNER_FORMS_DB_UNAVAILABLE', message: 'Database not configured' },
      },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid draft payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const { templateId, language, fillVars, jurisdiction } = parsed.data;
  const mapping = TEMPLATE_MAP[templateId];
  if (!mapping) {
    return c.json(
      { success: false, error: { code: 'UNKNOWN_TEMPLATE', message: `Unknown template "${templateId}"` } },
      400,
    );
  }

  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });

  try {
    const draft = await drafter.composeDraft({
      tenantId: auth.tenantId,
      userId: auth.userId,
      kind: mapping.kind,
      templateSlug: mapping.slug,
      language,
      titleSw: mapping.titleSw,
      titleEn: mapping.titleEn,
      ...(jurisdiction !== undefined ? { jurisdiction } : {}),
      fillVars,
    });

    moduleLogger.info('owner-forms: draft composed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      templateId,
      slug: mapping.slug,
      draftId: draft.id,
      contentBytes: draft.contentMd.length,
    });

    return c.json(
      {
        success: true,
        data: {
          draftId: draft.id,
          templateId,
          templateSlug: mapping.slug,
          language: draft.language,
          status: draft.status,
          titleSw: draft.titleSw,
          titleEn: draft.titleEn,
          contentMd: draft.contentMd,
          createdAt: draft.createdAt,
        },
      },
      201,
    );
  } catch (e) {
    moduleLogger.error('owner-forms: draft failed', {
      tenantId: auth.tenantId,
      templateId,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json(
      {
        success: false,
        error: { code: 'DRAFT_FAILED', message: e instanceof Error ? e.message : 'Draft failed' },
      },
      500,
    );
  }
});

app.get('/templates', async (c: any) => {
  return c.json({
    success: true,
    data: {
      templates: OWNER_TEMPLATE_IDS.map((id) => ({
        id,
        slug: TEMPLATE_MAP[id].slug,
        kind: TEMPLATE_MAP[id].kind,
        titleSw: TEMPLATE_MAP[id].titleSw,
        titleEn: TEMPLATE_MAP[id].titleEn,
      })),
    },
  });
});

export const ownerFormsRouter = app;
export default ownerFormsRouter;
