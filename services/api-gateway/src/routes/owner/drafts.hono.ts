/**
 * /api/v1/owner/drafts — Universal Drafter surface.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Exposes:
 *   POST /free-form              — compose a brand-new draft from a
 *                                  natural-language `intent`. Returns
 *                                  the markdown + sections + citations
 *                                  + a `draftId`.
 *   POST /:id/revise             — append a new revision (free-form
 *                                  edit instructions OR raw replacement
 *                                  markdown).
 *   GET  /:id/revisions          — list every revision (audit chain
 *                                  + citations counts).
 *   GET  /:id/revisions/:revNo   — fetch one revision in full.
 *   POST /:id/revert/:revNo      — revert by creating a new revision
 *                                  that copies the old one.
 *   GET  /:id/render?format=...  — render the current revision in the
 *                                  requested format (md/pdf/docx/pptx/html).
 *
 * The original v1 surface (`POST /api/v1/owner/forms/draft`) remains
 * intact for template-driven drafts.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  createDocumentDrafter,
  createDrizzleDraftPersistence,
} from '../../services/document-drafter';
import { createDrizzleRevisionsPersistence } from '../../services/document-drafter/revisions-persistence';
import {
  composeFreeForm,
  type FreeFormContextDoc,
} from '../../services/document-drafter/free-form-composer';
import { renderDraft, type RenderFormat } from '../../services/document-drafter/renderers';
import { tailOfHash } from '../../services/document-drafter/brand';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-drafts');

const contextDocSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  sourceKind: z.enum([
    'corpus_chunk',
    'owner_doc',
    'external_benchmark',
    'peer_cohort',
    'manual',
  ]),
  snippet: z.string().max(800).optional(),
});

const freeFormSchema = z.object({
  intent: z.string().min(1).max(2000),
  contextDocs: z.array(contextDocSchema).max(20).optional(),
  targetFormat: z.enum(['md', 'pdf', 'docx', 'pptx', 'html']).optional(),
  brandStyle: z.enum(['corporate', 'warm', 'regulator']).optional(),
  language: z.enum(['sw', 'en', 'bilingual']).optional(),
  citationMode: z.enum(['inline', 'footnote', 'none']).optional(),
  classification: z.enum(['public', 'internal', 'confidential']).optional(),
});

const reviseSchema = z.object({
  instruction: z.string().min(1).max(2000).optional(),
  replacementMarkdown: z.string().min(1).optional(),
}).refine((v) => Boolean(v.instruction) || Boolean(v.replacementMarkdown), {
  message: 'Either `instruction` or `replacementMarkdown` must be supplied',
});

const renderQuerySchema = z.object({
  format: z.enum(['md', 'pdf', 'docx', 'pptx', 'html']),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.post('/free-form', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = freeFormSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', issues: parsed.error.issues } },
      400,
    );
  }
  const input = parsed.data;
  try {
    const composed = await composeFreeForm({
      tenantId: auth.tenantId,
      ownerId: auth.userId,
      intent: input.intent,
      ...(input.contextDocs ? { contextDocs: input.contextDocs as ReadonlyArray<FreeFormContextDoc> } : {}),
      ...(input.targetFormat ? { targetFormat: input.targetFormat } : {}),
      ...(input.brandStyle ? { brandStyle: input.brandStyle } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.citationMode ? { citationMode: input.citationMode } : {}),
    });

    const persistence = createDrizzleDraftPersistence(db);
    const drafter = createDocumentDrafter({ persistence });
    const revisionsPersistence = createDrizzleRevisionsPersistence(db);
    const title = composed.inferredTitle;

    const draft = await persistence.insert({
      tenantId: auth.tenantId,
      createdByUserId: auth.userId,
      kind: composed.inferredKind,
      status: 'drafting',
      titleSw: title,
      titleEn: title,
      jurisdiction: 'TZ',
      language: input.language ?? 'en',
      contentMd: composed.markdown,
      sourceTemplateSlug: null,
      revisionCount: 1,
      lastRevisedAt: new Date(),
      parentDraftId: null,
      intent: input.intent,
      inferredKind: composed.inferredKind,
      currentRevisionNo: 1,
      classification: input.classification ?? 'internal',
    } as never);

    const revision = await revisionsPersistence.insertRevision({
      tenantId: auth.tenantId,
      draftId: draft.id,
      revisionNo: 1,
      contentMd: composed.markdown,
      contentFormat: 'markdown',
      createdBy: auth.userId,
      citations: composed.citations.map((c) => ({
        sourceKind: c.sourceKind,
        sourceRef: c.sourceRef,
        snippetUsed: c.snippetUsed ?? null,
      })),
    });
    for (const cite of composed.citations) {
      await revisionsPersistence.insertCitation({
        tenantId: auth.tenantId,
        draftId: draft.id,
        revisionId: revision.id,
        sourceKind: cite.sourceKind,
        sourceRef: cite.sourceRef,
        snippetUsed: cite.snippetUsed ?? null,
      });
    }
    void drafter;

    moduleLogger.info('drafts/free-form: composed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      draftId: draft.id,
      kind: composed.inferredKind,
      sections: composed.sections.length,
      citations: composed.citations.length,
    });

    return c.json(
      {
        success: true,
        data: {
          draftId: draft.id,
          markdown: composed.markdown,
          sections: composed.sections,
          citations: composed.citations,
          inferredTitle: composed.inferredTitle,
          inferredKind: composed.inferredKind,
          revisionNo: 1,
          auditHashTail: tailOfHash(revision.auditHash),
        },
      },
      200,
    );
  } catch (e) {
    moduleLogger.error('drafts/free-form: failed', {
      tenantId: auth.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json(
      { success: false, error: { code: 'FREE_FORM_FAILED', message: e instanceof Error ? e.message : 'Free-form compose failed' } },
      500,
    );
  }
});

app.get('/:id/revisions', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const rp = createDrizzleRevisionsPersistence(db);
  const list = await rp.listRevisions(auth.tenantId, id);
  return c.json({
    success: true,
    data: {
      draftId: id,
      revisions: list.map((r) => ({
        id: r.id,
        revisionNo: r.revisionNo,
        contentFormat: r.contentFormat,
        createdAt: r.createdAt,
        createdBy: r.createdBy,
        auditHashTail: tailOfHash(r.auditHash),
        contentPreview: r.contentMd.length > 240 ? r.contentMd.slice(0, 240) + '...' : r.contentMd,
      })),
    },
  });
});

app.get('/:id/revisions/:revNo', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const revNo = Number(c.req.param('revNo'));
  if (!Number.isFinite(revNo) || revNo < 1) {
    return c.json({ success: false, error: { code: 'BAD_REVISION_NO' } }, 400);
  }
  const rp = createDrizzleRevisionsPersistence(db);
  const rev = await rp.getRevision(auth.tenantId, id, revNo);
  if (!rev) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const cites = await rp.listCitations(auth.tenantId, rev.id);
  return c.json({
    success: true,
    data: {
      id: rev.id,
      revisionNo: rev.revisionNo,
      contentFormat: rev.contentFormat,
      contentMd: rev.contentMd,
      createdAt: rev.createdAt,
      createdBy: rev.createdBy,
      auditHashTail: tailOfHash(rev.auditHash),
      citations: cites,
    },
  });
});

app.post('/:id/revise', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const parsed = reviseSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
  }
  const persistence = createDrizzleDraftPersistence(db);
  const rp = createDrizzleRevisionsPersistence(db);
  const draft = await persistence.findById(auth.tenantId, id);
  if (!draft) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const list = await rp.listRevisions(auth.tenantId, id);
  const nextNo = list.length === 0 ? 1 : Math.max(...list.map((r) => r.revisionNo)) + 1;
  const newContent = parsed.data.replacementMarkdown ?? appendInstructionFooter(draft.contentMd, parsed.data.instruction ?? '');
  const rev = await rp.insertRevision({
    tenantId: auth.tenantId,
    draftId: id,
    revisionNo: nextNo,
    contentMd: newContent,
    contentFormat: 'markdown',
    createdBy: auth.userId,
  });
  await rp.bumpDraftCurrentRevision(auth.tenantId, id, nextNo);
  await persistence.updateContent(auth.tenantId, id, {
    contentMd: newContent,
    revisionCount: nextNo,
    lastRevisedAt: new Date(),
  });
  return c.json({
    success: true,
    data: { draftId: id, revisionNo: nextNo, auditHashTail: tailOfHash(rev.auditHash) },
  });
});

app.post('/:id/revisions/:revNo/lock', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const revNo = Number(c.req.param('revNo'));
  if (!Number.isFinite(revNo) || revNo < 1) {
    return c.json({ success: false, error: { code: 'BAD_REVISION_NO' } }, 400);
  }
  const raw = await c.req.json().catch(() => ({}));
  const reason = typeof raw.lockReason === 'string' ? raw.lockReason : undefined;
  const rp = createDrizzleRevisionsPersistence(db);
  const existing = await rp.getRevision(auth.tenantId, id, revNo);
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const locked = existing as unknown as { lockedAt?: unknown };
  if (locked.lockedAt !== null && locked.lockedAt !== undefined) {
    return c.json(
      { success: false, error: { code: 'ALREADY_LOCKED', message: 'Revision is already locked' } },
      409,
    );
  }
  const updated = await rp.lockRevision(auth.tenantId, id, revNo, auth.userId, reason);
  return c.json({
    success: true,
    data: {
      draftId: id,
      revisionNo: revNo,
      lockedAt: updated.lockedAt,
      lockedBy: updated.lockedByUserId,
      auditHashTail: tailOfHash(updated.auditHash),
    },
  });
});

app.get('/:id/lock-status', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const rp = createDrizzleRevisionsPersistence(db);
  const list = await rp.listRevisions(auth.tenantId, id);
  const latestNo = list.length === 0 ? 0 : Math.max(...list.map((r) => r.revisionNo));
  if (latestNo === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  const latest = list.find((r) => r.revisionNo === latestNo);
  const locked = latest as unknown as { lockedAt?: unknown; lockedByUserId?: unknown; lockReason?: unknown };
  return c.json({
    success: true,
    data: {
      currentRevisionNo: latestNo,
      isLocked: locked.lockedAt !== null && locked.lockedAt !== undefined,
      lockedAt: locked.lockedAt ?? null,
      lockedBy: locked.lockedByUserId ?? null,
      lockReason: locked.lockReason ?? null,
    },
  });
});

app.post('/:id/revert/:revNo', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const revNo = Number(c.req.param('revNo'));
  if (!Number.isFinite(revNo) || revNo < 1) {
    return c.json({ success: false, error: { code: 'BAD_REVISION_NO' } }, 400);
  }
  const persistence = createDrizzleDraftPersistence(db);
  const rp = createDrizzleRevisionsPersistence(db);
  const target = await rp.getRevision(auth.tenantId, id, revNo);
  if (!target) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const list = await rp.listRevisions(auth.tenantId, id);
  const nextNo = list.length === 0 ? 1 : Math.max(...list.map((r) => r.revisionNo)) + 1;
  const rev = await rp.insertRevision({
    tenantId: auth.tenantId,
    draftId: id,
    revisionNo: nextNo,
    contentMd: target.contentMd,
    contentFormat: target.contentFormat as 'markdown' | 'html' | 'plain',
    createdBy: auth.userId,
  });
  await rp.bumpDraftCurrentRevision(auth.tenantId, id, nextNo);
  await persistence.updateContent(auth.tenantId, id, {
    contentMd: target.contentMd,
    revisionCount: nextNo,
    lastRevisedAt: new Date(),
  });
  return c.json({
    success: true,
    data: {
      draftId: id,
      revertedFromRevisionNo: revNo,
      newRevisionNo: nextNo,
      auditHashTail: tailOfHash(rev.auditHash),
    },
  });
});

// Wave UNIVERSAL-DOC-DRAFTER scope 3 — convenience alias that always
// renders the latest revision as a PDF binary. Matches the FE's
// `<a href="/api/v1/owner/drafts/${id}/pdf" download>` link pattern.
app.get('/:id/pdf', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db)
    return c.json(
      { success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } },
      503,
    );
  const id = c.req.param('id');
  const persistence = createDrizzleDraftPersistence(db);
  const rp = createDrizzleRevisionsPersistence(db);
  const draft = await persistence.findById(auth.tenantId, id);
  if (!draft) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const list = await rp.listRevisions(auth.tenantId, id);
  const latestNo =
    list.length === 0 ? 1 : Math.max(...list.map((r) => r.revisionNo));
  const latest = list.find((r) => r.revisionNo === latestNo);
  const body = latest?.contentMd ?? draft.contentMd;
  const auditHash = latest?.auditHash ?? null;
  const tenantName =
    (auth as { tenantName?: string }).tenantName ?? 'Borjie tenant';
  const language = (draft.language === 'sw' || draft.language === 'en')
    ? draft.language
    : 'en';
  const result = await renderDraft(
    'pdf' as RenderFormat,
    body,
    {
      tenantName,
      title: draft.titleEn ?? draft.titleSw,
      auditHashTail: tailOfHash(auditHash),
      classification:
        (draft as unknown as {
          classification?: 'public' | 'internal' | 'confidential';
        }).classification ?? 'internal',
      author: auth.userId,
      renderedAtUtc: new Date().toISOString(),
    },
    { language },
  );
  return new Response(result.body as unknown as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="draft-${id}.${result.extension}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
});

app.get('/:id/render', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return c.json({ success: false, error: { code: 'DRAFTER_DB_UNAVAILABLE', message: 'no db' } }, 503);
  const id = c.req.param('id');
  const parsed = renderQuerySchema.safeParse({ format: c.req.query('format') });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid format' } }, 400);
  }
  const format = parsed.data.format as RenderFormat;
  const persistence = createDrizzleDraftPersistence(db);
  const rp = createDrizzleRevisionsPersistence(db);
  const draft = await persistence.findById(auth.tenantId, id);
  if (!draft) return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  const list = await rp.listRevisions(auth.tenantId, id);
  const latestNo = list.length === 0 ? 1 : Math.max(...list.map((r) => r.revisionNo));
  const latest = list.find((r) => r.revisionNo === latestNo);
  const body = latest?.contentMd ?? draft.contentMd;
  const auditHash = latest?.auditHash ?? null;
  const tenantName =
    (auth as { tenantName?: string }).tenantName ?? 'Borjie tenant';
  const language = (draft.language === 'sw' || draft.language === 'en')
    ? draft.language
    : 'en';
  const result = await renderDraft(
    format,
    body,
    {
      tenantName,
      title: draft.titleEn ?? draft.titleSw,
      auditHashTail: tailOfHash(auditHash),
      classification:
        (draft as unknown as { classification?: 'public' | 'internal' | 'confidential' })
          .classification ?? 'internal',
      author: auth.userId,
      renderedAtUtc: new Date().toISOString(),
    },
    { language },
  );
  return new Response(result.body as unknown as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="draft-${id}.${result.extension}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
});

function appendInstructionFooter(
  originalMarkdown: string,
  instruction: string,
): string {
  if (!instruction || instruction.trim().length === 0) return originalMarkdown;
  return [
    originalMarkdown.trimEnd(),
    '',
    '---',
    '',
    '## Revision Instruction (queued)',
    '',
    `> ${instruction}`,
  ].join('\n');
}

export const ownerDraftsRouter = app;
export default ownerDraftsRouter;
