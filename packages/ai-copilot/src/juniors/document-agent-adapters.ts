/**
 * Adapters for `document-agent.ts` — concrete PdfReader, ClaudeClient,
 * LicenceWriter, TemporalEntityWriter implementations. Kept separate so
 * the core junior stays under the file-size budget and so the pure
 * logic is testable without dynamic imports of `pdf-parse`, `fetch`, or
 * `drizzle-orm`.
 */

import { readFileSync } from 'node:fs';
import pdfParse from 'pdf-parse';
// Type-only import — adapters depend on the ports defined in
// document-agent.ts but must not pull the agent itself in at runtime,
// otherwise we have a cyclic import. `isolatedModules: true` requires
// the explicit `type` keyword for the import to be erased.
import type {
  ClaudeClient,
  LicenceWriter,
  PdfReader,
  TemporalEntityWriter,
} from './document-agent.js';

/**
 * Minimum surface needed from the `@borjie/database` client: Drizzle's
 * fluent API plus the raw `execute` escape hatch. The adapters below
 * only call `.insert(...)`, `.select(...).from(...).where(...).limit(...)`,
 * and `.onConflictDoNothing()` — typed by Drizzle once the schema map is
 * passed at client construction.
 */
interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
  insert: (table: unknown) => {
    values: (
      row: Record<string, unknown>,
    ) => {
      onConflictDoNothing: () => {
        returning: (cols: Record<string, unknown>) => Promise<
          ReadonlyArray<{ id: string }>
        >;
      };
      returning: (cols: Record<string, unknown>) => Promise<
        ReadonlyArray<{ id: string }>
      >;
    };
  };
  select: (cols: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (predicate: unknown) => {
        limit: (n: number) => Promise<ReadonlyArray<{ id: string }>>;
      };
    };
  };
}

/**
 * Default PDF reader. Uses `pdf-parse` (statically imported above) for
 * real PDFs; `.txt` fixtures used in tests bypass the parser and read
 * directly so the test suite stays decoupled from pdf-parse's lib-root
 * file-handle quirks.
 *
 * See gh-issue #23: swap to the @borjie/document-analysis OCR pipeline
 * so scanned PMLs are handled (Mistral OCR primary, Document AI
 * fallback per AGENT_PROMPT_LIBRARY §1 step 1).
 */
export function createDefaultPdfReader(): PdfReader {
  return {
    async readText(pdfPath: string): Promise<string> {
      if (/\.txt$/i.test(pdfPath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is supplied by the trusted junior workflow caller (tenant-scoped upload pipeline). PDF reader contract requires a filesystem path; non-literal is intrinsic.
        return readFileSync(pdfPath, 'utf8');
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above; trusted caller-supplied path to PDF fixture under tenant-scoped uploads.
      const buf = readFileSync(pdfPath);
      const out = await pdfParse(buf);
      return out.text ?? '';
    },
  };
}

/**
 * Default Claude client. Issues a single `messages` call against the
 * Anthropic REST API. Throws when ANTHROPIC_API_KEY is missing so the
 * caller learns about the missing wiring up front.
 *
 * See gh-issue #16: replace this thin wrapper with a direct import of
 * `AnthropicProvider` once the `juniors/` module is added to the
 * package's circular-dependency-safe import graph.
 */
export function createDefaultClaudeClient(): ClaudeClient {
  return {
    async complete({ systemPrompt, userPrompt, maxTokens, temperature, model }) {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY missing — wire a ClaudeClient explicitly');
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model ?? 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens ?? 1024,
          temperature: temperature ?? 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(`anthropic ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      return { content: text };
    },
  };
}

/**
 * Drizzle-backed LicenceWriter. Uses the typed `licences` schema added
 * in `packages/database/src/schemas/licences.schema.ts`. Because the
 * licences table requires a `company_id` FK and the document-agent
 * `LicenceRow` does not carry one (it knows only the holder name on the
 * PML), we resolve the tenant's first registered company at write time.
 * If no company exists yet, the insert is skipped and the row id is
 * still returned so the agent's downstream temporal-entity write is not
 * blocked — the operator can re-run after registering the company.
 */
export function createDrizzleLicenceWriter(db: DrizzleLikeClient): LicenceWriter {
  return {
    async insert(row) {
      const { eq } = await import('drizzle-orm');
      const { licences, companies } = await import('@borjie/database');

      const companyRows = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.tenantId, row.tenantId))
        .limit(1);
      const companyId = companyRows[0]?.id;
      if (!companyId) {
        // Soft-fail: no company on file for this tenant. Return the
        // generated id so callers can still link the temporal entity;
        // the persistence layer will surface this when the operator
        // attempts to query the licence later.
        return { id: row.id };
      }

      const inserted = await db
        .insert(licences)
        .values({
          id: row.id,
          tenantId: row.tenantId,
          companyId,
          kind: row.type,
          number: row.number,
          mineral: row.mineral,
          grantDate: row.grantDate,
          expiryDate: row.expiryDate,
          status: row.status,
          fees: {},
          obligations: {},
          attributes: row.attributes,
        })
        .onConflictDoNothing()
        .returning({ id: licences.id });

      return { id: inserted[0]?.id ?? row.id };
    },
  };
}

/**
 * Drizzle-backed TemporalEntityWriter. Uses the typed `temporalEntities`
 * schema which already carries the `confidence`, `evidence_ids`, and
 * `source` columns added in migration 0003_mining_domain.sql §16.
 */
export function createDrizzleTemporalEntityWriter(
  db: DrizzleLikeClient,
): TemporalEntityWriter {
  return {
    async insert(row) {
      const { temporalEntities } = await import('@borjie/database');

      const inserted = await db
        .insert(temporalEntities)
        .values({
          id: row.id,
          tenantId: row.tenantId,
          entityType: row.entityType,
          entityKey: row.entityKey,
          attributes: row.attributes,
          validFrom: new Date(row.validFrom),
          validTo: row.validTo ? new Date(row.validTo) : null,
          confidence: row.confidence.toFixed(2),
          evidenceIds: [...row.evidenceIds],
          source: row.source,
        })
        .onConflictDoNothing()
        .returning({ id: temporalEntities.id });

      return { id: inserted[0]?.id ?? row.id };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lazy default-surface helpers
// ─────────────────────────────────────────────────────────────────────

export function lazyClaudeClient(): ClaudeClient {
  let real: ClaudeClient | null = null;
  return {
    async complete(args) {
      if (!real) real = createDefaultClaudeClient();
      return real.complete(args);
    },
  };
}

export function lazyLicenceWriter(): LicenceWriter {
  return {
    async insert(row) {
      const db = await loadDb();
      if (!db) {
        throw new Error('licences write skipped — DATABASE_URL missing or @borjie/database not loaded');
      }
      return createDrizzleLicenceWriter(db).insert(row);
    },
  };
}

export function lazyTemporalEntityWriter(): TemporalEntityWriter {
  return {
    async insert(row) {
      const db = await loadDb();
      if (!db) {
        throw new Error('temporal_entities write skipped — DATABASE_URL missing or @borjie/database not loaded');
      }
      return createDrizzleTemporalEntityWriter(db).insert(row);
    },
  };
}

let cachedDb: DrizzleLikeClient | null | undefined;
async function loadDb(): Promise<DrizzleLikeClient | null> {
  if (cachedDb !== undefined) return cachedDb;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    cachedDb = null;
    return null;
  }
  try {
    const mod = (await import('@borjie/database')) as unknown as {
      createDatabaseClient?: (u: string) => DrizzleLikeClient;
    };
    if (typeof mod.createDatabaseClient !== 'function') {
      cachedDb = null;
      return null;
    }
    cachedDb = mod.createDatabaseClient(url);
    return cachedDb;
  } catch {
    cachedDb = null;
    return null;
  }
}

export type { DrizzleLikeClient };
