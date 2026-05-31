/**
 * /api/v1/mining/drafts — document drafter API.
 *
 * Companion to:
 *   - services/api-gateway/src/services/document-drafter/
 *   - packages/database/src/migrations/0084_drafts_registry.sql
 *
 * Routes:
 *   GET    /                 list current user's drafts (filter status / kind)
 *   POST   /                 direct create (for testing; brain normally drives)
 *   GET    /:id              fetch full content
 *   POST   /:id/revise       append a revision (chained via parent_draft_id)
 *   POST   /:id/finalize     lock the draft (status='finalized')
 *   POST   /:id/render       render the draft to a base64 PDF payload
 *
 * Tenant isolation: the `databaseMiddleware` sets
 * `app.current_tenant_id` on the connection so the RLS policy fires;
 * every handler also passes `tenantId` defensively to the service so
 * cross-tenant id lookups fail at the WITH CHECK predicate.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { DRAFT_KINDS, DRAFT_LANGUAGES, DRAFT_STATUSES } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  createDocumentDrafter,
  createDrizzleDraftPersistence,
} from '../../services/document-drafter';

// ---------------------------------------------------------------------------
// Zod schemas (request validation)
// ---------------------------------------------------------------------------

const createDraftSchema = z.object({
  kind: z.enum(DRAFT_KINDS),
  templateSlug: z.string().min(1).max(128),
  // English default per CLAUDE.md (flipped 2026-05).
  language: z.enum(DRAFT_LANGUAGES).default('en'),
  titleSw: z.string().min(1).max(512),
  titleEn: z.string().max(512).optional(),
  jurisdiction: z.string().max(8).optional(),
  fillVars: z.record(z.string(), z.unknown()).default({}),
});

const reviseDraftSchema = z.object({
  revisionInstruction: z.string().min(1).max(4000),
});

const listQuerySchema = z.object({
  status: z.enum(DRAFT_STATUSES).optional(),
  kind: z.enum(DRAFT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// ---------------------------------------------------------------------------
// Hono sub-app
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /  — list drafts created by the current user
// ---------------------------------------------------------------------------
app.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' },
      },
      503,
    );
  }
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    kind: c.req.query('kind'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  const listInput: Parameters<typeof drafter.listDrafts>[0] = {
    tenantId: auth.tenantId,
    userId: auth.userId,
  };
  if (parsed.data.status !== undefined) {
    (listInput as { status?: typeof parsed.data.status }).status = parsed.data.status;
  }
  if (parsed.data.kind !== undefined) {
    (listInput as { kind?: typeof parsed.data.kind }).kind = parsed.data.kind;
  }
  if (parsed.data.limit !== undefined) {
    (listInput as { limit?: number }).limit = parsed.data.limit;
  }
  const rows = await drafter.listDrafts(listInput);  return c.json({ success: true, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// POST /  — direct create
// ---------------------------------------------------------------------------
app.post('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' } },
      503,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createDraftSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid body',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  try {
    const composeInput: Parameters<typeof drafter.composeDraft>[0] = {
      tenantId: auth.tenantId,
      userId: auth.userId,
      kind: parsed.data.kind,
      templateSlug: parsed.data.templateSlug,
      language: parsed.data.language,
      titleSw: parsed.data.titleSw,
      fillVars: parsed.data.fillVars,
    };
    if (parsed.data.titleEn !== undefined) {
      (composeInput as { titleEn?: string }).titleEn = parsed.data.titleEn;
    }
    if (parsed.data.jurisdiction !== undefined) {
      (composeInput as { jurisdiction?: string }).jurisdiction = parsed.data.jurisdiction;
    }
    const draft = await drafter.composeDraft(composeInput);
    return c.json({ success: true, data: draft }, 201);
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'COMPOSE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to compose draft',
        },
      },
      400,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:id  — fetch full content
// ---------------------------------------------------------------------------
app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' } },
      503,
    );
  }
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  const draft = await drafter.getDraft({ tenantId: auth.tenantId, draftId: id });
  if (!draft) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Draft not found' } },
      404,
    );
  }
  return c.json({ success: true, data: draft }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/revise  — append a revision
// ---------------------------------------------------------------------------
app.post('/:id/revise', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' } },
      503,
    );
  }
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = reviseDraftSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid body',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  try {
    const revised = await drafter.reviseDraft({
      tenantId: auth.tenantId,
      draftId: id,
      instruction: parsed.data.revisionInstruction,
    });
    return c.json({ success: true, data: revised }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Revision failed';
    const code = message.includes('not found')
      ? 'NOT_FOUND'
      : message.includes('finalized') || message.includes('sent')
      ? 'CONFLICT'
      : 'REVISION_FAILED';
    const status = code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 400;
    return c.json({ success: false, error: { code, message } }, status);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/finalize  — lock the draft
// ---------------------------------------------------------------------------
app.post('/:id/finalize', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' } },
      503,
    );
  }
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  try {
    const finalized = await drafter.finalizeDraft({
      tenantId: auth.tenantId,
      draftId: id,
    });
    return c.json({ success: true, data: finalized }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Finalize failed';
    const isMissing = message.includes('not found');
    return c.json(
      {
        success: false,
        error: { code: isMissing ? 'NOT_FOUND' : 'FINALIZE_FAILED', message },
      },
      isMissing ? 404 : 400,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /:id/render  — render to PDF (returns base64 data URL)
// ---------------------------------------------------------------------------
app.post('/:id/render', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not initialised' } },
      503,
    );
  }
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } },
      400,
    );
  }
  const persistence = createDrizzleDraftPersistence(db);
  const drafter = createDocumentDrafter({ persistence });
  const draft = await drafter.getDraft({ tenantId: auth.tenantId, draftId: id });
  if (!draft) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Draft not found' } },
      404,
    );
  }
  const pdfBytes = renderMinimalMarkdownPdf({
    title: draft.titleEn ?? draft.titleSw,
    bodyMarkdown: draft.contentMd,
    draftId: draft.id,
    revisionCount: draft.revisionCount,
  });
  const dataUrl = `data:application/pdf;base64,${pdfBytes.toString('base64')}`;
  return c.json(
    {
      success: true,
      data: {
        draftId: draft.id,
        revisionCount: draft.revisionCount,
        pdfDataUrl: dataUrl,
        byteLength: pdfBytes.length,
      },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Minimal PDF 1.4 generator — emits a single-page A4 document with
 * the title as a header and the markdown body as preformatted text.
 *
 * We hand-roll the PDF rather than pulling in a heavyweight renderer
 * because:
 *   - `pdfkit` is not declared as an api-gateway dependency.
 *   - The output is binary-correct (`%PDF-1.4` magic + valid xref +
 *     EOF marker) and parses cleanly in every reader we tested.
 *
 * The intent is a reviewable artefact for human signature workflows;
 * once a heavyweight renderer is wired (Playwright in the artifact
 * pipeline), the route can simply switch to that adapter.
 */
function renderMinimalMarkdownPdf(input: {
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly draftId: string;
  readonly revisionCount: number;
}): Buffer {
  const lines = [
    input.title.toUpperCase(),
    '',
    `Draft ID: ${input.draftId}`,
    `Revision: v${input.revisionCount}`,
    '',
    ...input.bodyMarkdown.split('\n').slice(0, 200),
  ];
  // Escape each line for inclusion in a PDF text-showing operator.
  const textOps = lines
    .map((rawLine, index) => {
      const cleaned = sanitisePdfLine(rawLine);
      const y = 800 - index * 14;
      return `BT /F1 10 Tf 50 ${y} Td (${cleaned}) Tj ET`;
    })
    .join('\n');
  const stream = textOps;
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); // 2
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  ); // 3
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 4
  objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`); // 5

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function sanitisePdfLine(line: string): string {
  return line
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 220);
}

export const miningDraftsRouter = app;
