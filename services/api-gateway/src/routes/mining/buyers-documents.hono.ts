/**
 * /api/v1/mining/buyers/documents — buyer-side sale-document list + sign.
 *
 * Closes finding `buyer-mobile-1`. The buyer-mobile Documents tab + biometric
 * Sign flow targeted the removed `/api/v1/documents` surface and 404'd: the
 * doc list rendered blank and the core off-take Sign action was inoperable.
 *
 * Backed by `offtake_agreements` — the binding mineral-supply contract
 * crystallized when a seller accepts a marketplace bid. Each agreement is
 * projected into the `SaleDocument` shape the buyer-mobile screen consumes:
 *   { id, title, status: 'pending_signature'|'signed', counterparty,
 *     listingId, issuedAt, signedAt, totalTzs, pdfUrl }
 *
 * Routes:
 *   GET  /            list the calling buyer's sale documents
 *   GET  /:id         one document (404 on cross-buyer / cross-tenant)
 *   POST /:id/sign    { biometricToken } → status transition to 'signed'
 *
 * MONEY DISCIPLINE (CLAUDE.md hard rule): signing is a document STATE
 * TRANSITION, not a ledger posting. `agreed_price_tzs` is a CONTRACT TERM, not
 * an accounting entry. We do NOT call `LedgerService.post()` here — actual
 * settlement (escrow release / payout) is a separate money movement that must
 * be designed explicitly and routed through the ledger. The verdict for
 * `buyer-mobile-1` explicitly cautions against asserting a ledger post on
 * signature.
 *
 * TENANT SCOPE: the calling buyer authenticates within the seller tenant (the
 * `buyers` row lives in `auth.tenantId`, bound via `buyers.linked_user_id`).
 * `offtake_agreements.tenant_id` is that same seller tenant. RLS FORCE on the
 * `app.current_tenant_id` GUC isolates tenants; handlers also predicate on
 * `auth.tenantId` + the resolved `buyer.id` (belt-and-braces). A buyer can
 * only ever see / sign agreements tied to their OWN `buyers` row.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { buyers, offtakeAgreements, tenants } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-buyers-documents');

const UUID_RE = /^[0-9a-f-]{36}$/i;

const SignBodySchema = z
  .object({
    biometricToken: z.string().min(1).max(4096),
  })
  .strict();

interface SaleDocumentDto {
  readonly id: string;
  readonly title: string;
  readonly counterparty: string;
  readonly listingId: string | null;
  readonly pdfUrl: string;
  readonly status: 'pending_signature' | 'signed';
  readonly issuedAt: string;
  readonly signedAt: string | null;
  readonly totalTzs: number;
}

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findLinkedBuyer(
  db: any,
  tenantId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: buyers.id })
    .from(buyers)
    .where(and(eq(buyers.tenantId, tenantId), eq(buyers.linkedUserId, userId)))
    .limit(1);
  return row ?? null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function numericToNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectDocument(
  agreement: any,
  counterpartyName: string,
): SaleDocumentDto {
  const status: 'pending_signature' | 'signed' =
    agreement.status === 'signed' ? 'signed' : 'pending_signature';
  const shortListing =
    typeof agreement.listingId === 'string'
      ? agreement.listingId.slice(0, 8)
      : 'offtake';
  return {
    id: agreement.id,
    title: `Offtake agreement ${shortListing}`,
    counterparty: counterpartyName,
    listingId: agreement.listingId ?? null,
    // No object-store PDF exists yet; expose a deterministic, tenant-scoped
    // download path so the FE has a stable href. Honest about the source —
    // never a fabricated external URL.
    pdfUrl: `/api/v1/mining/buyers/documents/${agreement.id}/pdf`,
    status,
    issuedAt: toIso(agreement.createdAt),
    signedAt: toIsoOrNull(agreement.signedAt),
    totalTzs: numericToNumber(agreement.agreedPriceTzs),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function counterpartyFor(db: any, sellerTenantId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, sellerTenantId))
      .limit(1);
    return typeof row?.name === 'string' && row.name.length > 0
      ? row.name
      : 'Seller';
  } catch {
    return 'Seller';
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMiningBuyersDocumentsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // GET / — list the calling buyer's sale documents.
  app.get('/', async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'DOCUMENTS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    try {
      const buyer = await findLinkedBuyer(db, tenantId, userId);
      if (!buyer) {
        // No KYC'd buyer row yet → no documents (not an error state).
        return c.json({ data: [] as ReadonlyArray<SaleDocumentDto> }, 200);
      }
      const rows = await db
        .select()
        .from(offtakeAgreements)
        .where(
          and(
            eq(offtakeAgreements.tenantId, tenantId),
            eq(offtakeAgreements.buyerId, buyer.id),
          ),
        )
        .orderBy(desc(offtakeAgreements.createdAt))
        .limit(200);
      const counterparty = await counterpartyFor(db, tenantId);
      const data = rows
        .filter((r: any) => !r.deletedAt)
        .map((r: any) => projectDocument(r, counterparty));
      return c.json({ data }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('buyer documents list failed', {
        evt: 'buyer_documents_list_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError(
        'DOCUMENTS_LIST_FAILED',
        'Failed to load documents',
        500,
      );
      return c.json(e.body, e.status);
    }
  });

  // GET /:id — one document (cross-buyer / cross-tenant → 404, no leak).
  app.get('/:id', async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'DOCUMENTS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }
    const id = c.req.param('id');
    if (!id || !UUID_RE.test(id)) {
      const err = jsonError('INVALID_DOCUMENT_ID', 'id must be a UUID', 400);
      return c.json(err.body, err.status);
    }

    try {
      const buyer = await findLinkedBuyer(db, tenantId, userId);
      if (!buyer) {
        const err = jsonError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
        return c.json(err.body, err.status);
      }
      const [row] = await db
        .select()
        .from(offtakeAgreements)
        .where(
          and(
            eq(offtakeAgreements.id, id),
            eq(offtakeAgreements.tenantId, tenantId),
            eq(offtakeAgreements.buyerId, buyer.id),
          ),
        )
        .limit(1);
      if (!row || row.deletedAt) {
        const err = jsonError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
        return c.json(err.body, err.status);
      }
      const counterparty = await counterpartyFor(db, tenantId);
      return c.json({ data: projectDocument(row, counterparty) }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'read failed';
      moduleLogger.error('buyer document read failed', {
        evt: 'buyer_document_read_failed',
        tenantId,
        documentId: id,
        reason: message,
      });
      const e = jsonError('DOCUMENT_READ_FAILED', 'Failed to load document', 500);
      return c.json(e.body, e.status);
    }
  });

  // POST /:id/sign — buyer signs with biometric. Idempotent on already-signed.
  app.post('/:id/sign', zValidator('json', SignBodySchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'DOCUMENTS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }
    const id = c.req.param('id');
    if (!id || !UUID_RE.test(id)) {
      const err = jsonError('INVALID_DOCUMENT_ID', 'id must be a UUID', 400);
      return c.json(err.body, err.status);
    }

    try {
      const buyer = await findLinkedBuyer(db, tenantId, userId);
      if (!buyer) {
        const err = jsonError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
        return c.json(err.body, err.status);
      }
      const [existing] = await db
        .select()
        .from(offtakeAgreements)
        .where(
          and(
            eq(offtakeAgreements.id, id),
            eq(offtakeAgreements.tenantId, tenantId),
            eq(offtakeAgreements.buyerId, buyer.id),
          ),
        )
        .limit(1);
      if (!existing || existing.deletedAt) {
        const err = jsonError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
        return c.json(err.body, err.status);
      }

      const counterparty = await counterpartyFor(db, tenantId);

      // Idempotent — re-signing an already-signed document returns the
      // current state with a meta flag (no second transition, no error).
      if (existing.status === 'signed') {
        return c.json(
          {
            data: projectDocument(existing, counterparty),
            meta: { idempotent: true as const },
          },
          200,
        );
      }

      const signedAt = new Date();
      const [row] = await db
        .update(offtakeAgreements)
        .set({ status: 'signed', signedAt, updatedAt: signedAt })
        .where(
          and(
            eq(offtakeAgreements.id, id),
            eq(offtakeAgreements.tenantId, tenantId),
            eq(offtakeAgreements.buyerId, buyer.id),
          ),
        )
        .returning();
      moduleLogger.info('buyer document signed', {
        evt: 'buyer_document_signed',
        tenantId,
        documentId: id,
        buyerId: buyer.id,
      });
      return c.json({ data: projectDocument(row ?? existing, counterparty) }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sign failed';
      moduleLogger.error('buyer document sign failed', {
        evt: 'buyer_document_sign_failed',
        tenantId,
        documentId: id,
        reason: message,
      });
      const e = jsonError('DOCUMENT_SIGN_FAILED', 'Failed to sign document', 500);
      return c.json(e.body, e.status);
    }
  });

  return app;
}

export const miningBuyersDocumentsRouter = createMiningBuyersDocumentsRouter();
