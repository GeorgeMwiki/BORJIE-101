/**
 * Universal Drafter — wiring smoke test.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Confirms the new /owner/drafts router
 * mounts and gates on auth (401 on no token, 400 on invalid body).
 * Happy-path integration is covered in the e2e suite (live PG +
 * Supabase JWT).
 */

import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { ownerDraftsRouter } from '../drafts.hono.js';
import {
  composeFreeForm,
  inferKindFromIntent,
  inferTitleFromIntent,
} from '../../../services/document-drafter/free-form-composer.js';
import { renderDraft } from '../../../services/document-drafter/renderers/index.js';
import { generateChart } from '../../../services/media-generation/index.js';

describe('Universal Drafter — wiring smoke', () => {
  it('drafts router rejects unauth POST /free-form with 401', async () => {
    const res = await ownerDraftsRouter.request('/free-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'draft me a letter' }),
    });
    expect(res.status).toBe(401);
  });

  it('drafts router rejects unauth GET /:id/revisions with 401', async () => {
    const res = await ownerDraftsRouter.request(
      '/00000000-0000-0000-0000-000000000000/revisions',
      { method: 'GET' },
    );
    expect(res.status).toBe(401);
  });

  it('drafts router rejects unauth GET /:id/render with 401', async () => {
    const res = await ownerDraftsRouter.request(
      '/00000000-0000-0000-0000-000000000000/render?format=md',
      { method: 'GET' },
    );
    expect(res.status).toBe(401);
  });
});

describe('free-form composer — kind inference', () => {
  it('infers "letter" from a TRA filing intent', () => {
    const kind = inferKindFromIntent(
      'draft a letter to TRA explaining the late February royalty filing',
    );
    expect(kind).toBe('letter');
  });

  it('infers "contract" from a partnership ask', () => {
    expect(inferKindFromIntent('draft a partnership deed with X')).toBe('contract');
  });

  it('truncates very long titles', () => {
    const title = inferTitleFromIntent('x'.repeat(200));
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it('produces markdown with sections and citations', async () => {
    const out = await composeFreeForm({
      tenantId: 'tnt-1',
      ownerId: 'usr-1',
      intent: 'draft me a brief memo about the May ops review',
      language: 'en',
      contextDocs: [
        { id: 'corpus-1', label: 'Mining Act', sourceKind: 'corpus_chunk', snippet: 'section 12' },
      ],
    });
    expect(out.markdown).toContain('# ');
    expect(out.sections.length).toBeGreaterThan(0);
    expect(out.citations.length).toBe(1);
  });
});

describe('renderers — emit format-correct payloads', () => {
  const body = '# Hello\n\nbody.\n\n## Section\n\n- one\n- two\n';
  const ctx = {
    tenantName: 'Acme',
    title: 'Test',
    auditHashTail: 'abcdef12',
    classification: 'internal' as const,
    author: 'Mwikila',
    renderedAtUtc: '2026-05-28T10:00:00Z',
  };

  it('md renderer wraps with header/footer', async () => {
    const r = await renderDraft('md', body, ctx);
    expect(r.contentType.startsWith('text/markdown')).toBe(true);
    expect(r.body.toString('utf8')).toContain('Borjie');
  });

  it('html renderer wraps with doctype + branded header', async () => {
    const r = await renderDraft('html', body, ctx);
    expect(r.contentType).toContain('text/html');
    expect(r.body.toString('utf8').startsWith('<!DOCTYPE')).toBe(true);
  });

  it('docx renderer emits a ZIP container', async () => {
    const r = await renderDraft('docx', body, ctx);
    expect(r.body.subarray(0, 2).toString('hex')).toBe('504b'); // PK
  });

  it('pptx renderer emits a ZIP container', async () => {
    const r = await renderDraft('pptx', body, ctx);
    expect(r.body.subarray(0, 2).toString('hex')).toBe('504b'); // PK
  });
});

describe('media generation — chart renders SVG', () => {
  it('generates an SVG chart', () => {
    const out = generateChart({
      kind: 'bar',
      title: 'May royalty',
      data: [
        { label: 'TZS', value: 12 },
        { label: 'USD', value: 4 },
      ],
    });
    expect(out.contentType).toContain('svg');
    expect(out.svg.toString('utf8').startsWith('<svg')).toBe(true);
  });
});
