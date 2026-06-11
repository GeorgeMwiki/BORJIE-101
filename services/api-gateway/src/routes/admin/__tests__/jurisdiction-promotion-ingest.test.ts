/**
 * Jurisdiction compliance LEARN-FEED route tests — JC-7c.
 *
 * Locks the contract of `POST /admin/jurisdictions/:code/ingest-compliance`
 * end-to-end through Hono's `app.request()` (mirrors tab-projection.test.ts):
 *
 *   1. A valid ingest writes N chunks into intelligence_corpus_chunks with
 *      tenant_id = NULL and source_file = 'admin:jurisdiction:<CODE>'.
 *   2. recordUpload is called with the chunk count + 'ingested' status.
 *   3. Embeddings are NULL (honest text-only path) — never faked.
 *   4. The admin-gate REJECTS a non-platform-admin (403).
 *   5. A bad country code → 400; empty content → 422; missing content → 400.
 *   6. isRegulatory:false is refused (422) — the shared corpus is public only.
 *
 * Plus pure-function units for the chunker.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    c.set('db', (globalThis as any).__BORJIE_TEST_DB__);
    await next();
  },
}));

import { createJurisdictionPromotionRouter } from '../jurisdiction-promotion.hono';
import { chunkComplianceText } from '../compliance-corpus-chunker';
import { UserRole } from '../../../types/user-role';

// ---------------------------------------------------------------------------
// In-memory drizzle stand-in. Captures every insert's table + rows so the
// assertions are real (tenant_id NULL, source prefix, embedding null, count).
// ---------------------------------------------------------------------------

function tableName(table: any): string {
  if (!table) return '';
  for (const sym of Object.getOwnPropertySymbols(table)) {
    const name = String((table as any)[sym] ?? '');
    if (name.includes('intelligence_corpus_chunks')) return 'corpus';
    if (name.includes('compliance_doc_uploads')) return 'uploads';
  }
  return '';
}

function makeDb() {
  const inserts: Array<{ table: string; rows: any[] }> = [];
  const db = {
    inserts,
    insert(table: any) {
      const name = tableName(table);
      return {
        values(rows: any) {
          const arr = Array.isArray(rows) ? rows : [rows];
          inserts.push({ table: name, rows: arr });
          // recordUpload's insert has no onConflict — resolve directly.
          const thenable = Promise.resolve(undefined);
          return Object.assign(thenable, {
            onConflictDoUpdate() {
              return Promise.resolve(undefined);
            },
          });
        },
      };
    },
  };
  return db;
}

function setAuth(role: UserRole | null) {
  if (role === null) {
    (globalThis as any).__BORJIE_TEST_AUTH__ = undefined;
    return;
  }
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    role,
    userId: 'admin_1',
    tenantId: 'borjie_ops',
  };
}

const SAMPLE = [
  'The Mining Act 2099 establishes the National Minerals Authority as the licensing regulator.',
  '',
  'Royalty on gold is six percent of gross value, payable monthly to the Treasury.',
  '',
  'Environmental impact assessments are administered by the Environment Council.',
].join('\n');

describe('POST /admin/jurisdictions/:code/ingest-compliance', () => {
  beforeEach(() => {
    (globalThis as any).__BORJIE_TEST_DB__ = makeDb();
    setAuth(UserRole.ADMIN);
  });

  async function ingest(code: string, body: unknown) {
    const app = createJurisdictionPromotionRouter();
    return app.request(`/${code}/ingest-compliance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('writes N chunks to the shared corpus with tenant_id NULL + source prefix', async () => {
    const res = await ingest('US', {
      title: 'US Mining Law',
      content: SAMPLE,
      docType: 'mining_act',
      sourceUrl: 'https://example.gov/mining',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.ingested).toBe(true);
    expect(json.data.country).toBe('US');
    expect(json.data.source).toBe('admin:jurisdiction:US');
    expect(json.data.embedded).toBe(false);
    expect(json.data.chunks).toBeGreaterThan(0);

    const db = (globalThis as any).__BORJIE_TEST_DB__;
    const corpus = db.inserts.find((i: any) => i.table === 'corpus');
    expect(corpus).toBeTruthy();
    expect(corpus.rows.length).toBe(json.data.chunks);
    for (const row of corpus.rows) {
      expect(row.tenantId).toBeNull();
      expect(row.sourceFile).toBe('admin:jurisdiction:US');
      expect(row.embedding).toBeNull(); // honest — never faked
      expect(row.metadata.jurisdiction).toBe('US');
      expect(typeof row.text).toBe('string');
      expect(row.text.length).toBeGreaterThan(0);
    }
  });

  it('records provenance via recordUpload with the chunk count + ingested status', async () => {
    const res = await ingest('US', { title: 'US Mining Law', content: SAMPLE });
    const json = (await res.json()) as any;
    const db = (globalThis as any).__BORJIE_TEST_DB__;
    const upload = db.inserts.find((i: any) => i.table === 'uploads');
    expect(upload).toBeTruthy();
    expect(upload.rows[0].countryCode).toBe('US');
    expect(upload.rows[0].corpusChunkCount).toBe(json.data.chunks);
    expect(upload.rows[0].extractionStatus).toBe('ingested');
    expect(upload.rows[0].filePath).toBe('admin:jurisdiction:US');
  });

  it('REJECTS a non-platform-admin (403)', async () => {
    setAuth(UserRole.OWNER);
    const res = await ingest('US', { title: 'X', content: SAMPLE });
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe('FORBIDDEN');
  });

  it('rejects a bad country code (400)', async () => {
    const res = await ingest('UNITEDSTATES', { title: 'X', content: SAMPLE });
    expect(res.status).toBe(400);
  });

  it('rejects empty content (400 — schema min(1))', async () => {
    const res = await ingest('US', { title: 'X', content: '' });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only content that chunks to zero (422)', async () => {
    const res = await ingest('US', { title: 'X', content: '   \n\n   ' });
    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe('EMPTY_CONTENT');
  });

  it('rejects content flagged non-regulatory (422) — shared corpus is public only', async () => {
    const res = await ingest('US', {
      title: 'X',
      content: SAMPLE,
      isRegulatory: false,
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe('NON_REGULATORY');
  });
});

describe('chunkComplianceText (pure)', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(chunkComplianceText('')).toEqual([]);
    expect(chunkComplianceText('   \n\n  ')).toEqual([]);
  });

  it('packs paragraphs into bounded windows', () => {
    const chunks = chunkComplianceText(SAMPLE);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600);
  });

  it('hard-splits a single oversized paragraph', () => {
    const big = 'x'.repeat(5000);
    const chunks = chunkComplianceText(big, { maxChars: 1000 });
    expect(chunks.length).toBe(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it('is deterministic — same input yields same chunks', () => {
    expect(chunkComplianceText(SAMPLE)).toEqual(chunkComplianceText(SAMPLE));
  });
});
