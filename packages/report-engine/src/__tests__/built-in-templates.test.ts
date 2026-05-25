/**
 * Built-in template parity test — assert the TS-mirror in
 * `templates/built-in.ts` matches the SQL seed in migration
 * `0208_report_templates.sql`.
 *
 * The test reads the migration file from disk and parses the seven
 * INSERT rows by id. For each row, it asserts the corresponding
 * BUILT_IN_TEMPLATES entry has the same slug, displayName, sections
 * (count + ids), and output_formats.
 *
 * This catches drift between the SQL seed and the TS-mirror without
 * standing up a real database.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILT_IN_TEMPLATES } from '../templates/built-in.js';
import {
  InMemoryReportTemplateStore,
  type ReportTemplate,
} from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  here,
  '..',
  '..',
  '..',
  'database',
  'src',
  'migrations',
  '0208_report_templates.sql',
);

interface MigrationRow {
  readonly id: string;
  readonly slug: string;
  readonly displayNameEn: string;
  readonly displayNameSw: string | null;
  readonly sectionsRaw: string;
  readonly outputFormatsRaw: string;
}

function readSeedRows(): MigrationRow[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const rows: MigrationRow[] = [];
  // Each row block starts with `( '<id>',`. We grab the chunks
  // between row openers and parse out the simple-string fields.
  const blocks = sql.split(/\(\s*\n\s*'(tmpl_[^']+)'/g);
  // blocks[0] is the prelude; subsequent pairs are [id, body, id, body, …].
  // The body starts immediately after the id (with a comma) and
  // contains: tenant_id, slug, name_en, name_sw, sections, formats, …
  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i]!;
    const body = blocks[i + 1] ?? '';
    const tokens = parseRowBody(body);
    if (tokens.length < 6) continue;
    // tokens[0] is the leading empty piece before the first comma.
    // tokens[1] = tenant_id (NULL)
    // tokens[2] = slug
    // tokens[3] = display_name_en
    // tokens[4] = display_name_sw
    // tokens[5] = sections_jsonb
    // tokens[6] = output_formats
    const slug = tokens[2] ?? '';
    const displayNameEn = tokens[3] ?? '';
    const displayNameSw = tokens[4] ?? 'NULL';
    const sectionsRaw = tokens[5] ?? '';
    const outputFormatsRaw = tokens[6] ?? '';
    rows.push({
      id,
      slug,
      displayNameEn,
      displayNameSw: displayNameSw === 'NULL' ? null : displayNameSw,
      sectionsRaw,
      outputFormatsRaw,
    });
  }
  return rows;
}

/**
 * Parse the comma-separated row body up to the matching `)` of the
 * VALUES tuple. Strings are SQL-quoted, JSONB blobs end in ::jsonb,
 * arrays end in ::TEXT[].
 */
function parseRowBody(body: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let inString = false;
  let inDollar = false;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const next = body[i + 1];
    if (!inString && !inDollar) {
      if (ch === '(') depth++;
      if (ch === ')' && depth === 0) {
        tokens.push(current.trim());
        return tokens;
      }
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        tokens.push(current.trim());
        current = '';
        continue;
      }
      if (ch === "'") {
        inString = true;
        current += ch;
        continue;
      }
      current += ch;
    } else if (inString) {
      current += ch;
      if (ch === "'" && next !== "'") {
        inString = false;
      }
    } else if (inDollar) {
      current += ch;
    }
  }
  tokens.push(current.trim());
  return tokens;
}

/**
 * Strip surrounding single quotes, double-quote escapes, and trailing
 * SQL casts (e.g. `::jsonb`, `::TEXT[]`).
 */
function unquote(token: string): string {
  let t = token.trim();
  // Strip cast suffix.
  t = t.replace(/::[A-Za-z_\[\]]+$/g, '').trim();
  // Strip ARRAY[…]::… prefix already handled — fall through for plain strings.
  if (t.startsWith('ARRAY[')) {
    return t.slice('ARRAY['.length, t.lastIndexOf(']'));
  }
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

describe('built-in templates parity (TS mirror ⇔ migration 0208)', () => {
  const seedRows = readSeedRows();

  it('migration seeds exactly seven built-in rows', () => {
    expect(seedRows).toHaveLength(7);
  });

  it('every BUILT_IN_TEMPLATES entry has a matching seed row', () => {
    const seededSlugs = new Set(seedRows.map((r) => unquote(r.slug)));
    for (const slug of Object.keys(BUILT_IN_TEMPLATES)) {
      expect(seededSlugs.has(slug)).toBe(true);
    }
  });

  it('every seed row has a matching BUILT_IN_TEMPLATES entry', () => {
    for (const row of seedRows) {
      const slug = unquote(row.slug);
      const entry = BUILT_IN_TEMPLATES[slug] as ReportTemplate | undefined;
      expect(entry, `Missing TS-mirror for ${slug}`).toBeDefined();
      expect(entry!.id).toBe(row.id);
      expect(entry!.displayNameEn).toBe(unquote(row.displayNameEn));
      if (row.displayNameSw == null) {
        expect(entry!.displayNameSw).toBeNull();
      } else {
        expect(entry!.displayNameSw).toBe(unquote(row.displayNameSw));
      }
    }
  });

  it('InMemoryReportTemplateStore returns built-in by slug', async () => {
    const store = new InMemoryReportTemplateStore();
    const tmpl = await store.findBySlug({
      tenantId: 'tenant-1',
      slug: 'q3_strategy',
    });
    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe('tmpl_q3_strategy');
  });

  it('InMemoryReportTemplateStore can register tenant overrides', async () => {
    const store = new InMemoryReportTemplateStore();
    const custom: ReportTemplate = {
      id: 'custom_x',
      tenantId: 'tenant-1',
      slug: 'q3_strategy',
      displayNameEn: 'Custom Q3 Strategy',
      displayNameSw: null,
      sections: [],
      outputFormats: ['pdf'],
      isBuiltIn: false,
    };
    store.registerTenantOverride(custom);
    const tmpl = await store.findBySlug({
      tenantId: 'tenant-1',
      slug: 'q3_strategy',
    });
    expect(tmpl!.id).toBe('custom_x');
    // Other tenants still see the built-in.
    const t2 = await store.findBySlug({
      tenantId: 'tenant-2',
      slug: 'q3_strategy',
    });
    expect(t2!.id).toBe('tmpl_q3_strategy');
  });

  it('rejects registerTenantOverride for templates without a tenantId', () => {
    const store = new InMemoryReportTemplateStore();
    expect(() =>
      store.registerTenantOverride({
        id: 'bad',
        tenantId: null,
        slug: 'q3_strategy',
        displayNameEn: 'Bad',
        displayNameSw: null,
        sections: [],
        outputFormats: ['pdf'],
        isBuiltIn: false,
      }),
    ).toThrow(/tenantId/);
  });
});
