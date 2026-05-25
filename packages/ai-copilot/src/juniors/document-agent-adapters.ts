/**
 * Adapters for `document-agent.ts` — concrete PdfReader, ClaudeClient,
 * LicenceWriter, TemporalEntityWriter implementations. Kept separate so
 * the core junior stays under the file-size budget and so the pure
 * logic is testable without dynamic imports of `pdf-parse`, `fetch`, or
 * `drizzle-orm`.
 */

import { readFileSync } from 'node:fs';
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

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

/**
 * Default PDF reader. Tries `pdf-parse` (used by @borjie/document-
 * analysis) via dynamic import; on failure or for `.txt` fixtures used
 * in tests, falls back to `readFileSync`.
 *
 * TODO(phase-3): swap to the @borjie/document-analysis OCR pipeline so
 * scanned PMLs are handled (Mistral OCR primary, Document AI fallback
 * per AGENT_PROMPT_LIBRARY §1 step 1).
 */
export function createDefaultPdfReader(): PdfReader {
  return {
    async readText(pdfPath: string): Promise<string> {
      if (/\.txt$/i.test(pdfPath)) {
        return readFileSync(pdfPath, 'utf8');
      }
      try {
        const mod = (await import('pdf-parse')) as {
          default?: (buf: Buffer) => Promise<{ text: string }>;
        };
        const fn = mod.default;
        if (typeof fn !== 'function') {
          throw new Error('pdf-parse default export is not a function');
        }
        const buf = readFileSync(pdfPath);
        const out = await fn(buf);
        return out.text ?? '';
      } catch {
        // Fallback: best-effort text read so the agent always returns
        // something for the caller to inspect. Production should never
        // hit this path — pdf-parse is the contract.
        return readFileSync(pdfPath, 'utf8');
      }
    },
  };
}

/**
 * Default Claude client. Issues a single `messages` call against the
 * Anthropic REST API. Throws when ANTHROPIC_API_KEY is missing so the
 * caller learns about the missing wiring up front.
 *
 * TODO: replace this thin wrapper with a direct import of
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
 * Drizzle-backed LicenceWriter. Raw SQL because the `licences` table
 * (DATA_MODEL.md §3.1) is not yet present in
 * `packages/database/src/schemas/`.
 *
 * TODO(phase-3): swap to a typed `db.insert(licences).values(...)
 * .returning({ id: licences.id })` once the schema is added.
 */
export function createDrizzleLicenceWriter(db: DrizzleLikeClient): LicenceWriter {
  return {
    async insert(row) {
      const { sql } = await import('drizzle-orm');
      const attributesJson = JSON.stringify(row.attributes);
      await db.execute(
        sql`INSERT INTO licences
              (id, tenant_id, type, number, mineral,
               grant_date, expiry_date, status, fees, obligations, created_at)
            VALUES (${row.id}, ${row.tenantId}, ${row.type}, ${row.number}, ${row.mineral},
                    ${row.grantDate}::date, ${row.expiryDate}::date, ${row.status},
                    ${attributesJson}::jsonb, '{}'::jsonb, NOW())
            ON CONFLICT (id) DO NOTHING`,
      );
      return { id: row.id };
    },
  };
}

/**
 * Drizzle-backed TemporalEntityWriter. The existing `temporalEntities`
 * schema lacks `confidence`, `evidence_ids`, and `source` columns
 * (DATA_MODEL.md §2 calls for them, schema does not yet). Raw SQL here
 * writes the additional columns once they exist.
 *
 * TODO(phase-3): extend `packages/database/src/schemas/temporal-entity-
 * graph.schema.ts` with `confidence`, `evidenceIds`, `source`, then
 * swap this adapter for a typed Drizzle insert.
 */
export function createDrizzleTemporalEntityWriter(
  db: DrizzleLikeClient,
): TemporalEntityWriter {
  return {
    async insert(row) {
      const { sql } = await import('drizzle-orm');
      const attributesJson = JSON.stringify(row.attributes);
      const evidenceArray = `{${row.evidenceIds
        .map((id) => `"${id.replace(/"/g, '\\"')}"`)
        .join(',')}}`;
      await db.execute(
        sql`INSERT INTO temporal_entities
              (id, tenant_id, entity_type, entity_key, attributes,
               valid_from, valid_to, recorded_at,
               confidence, evidence_ids, source)
            VALUES (${row.id}, ${row.tenantId}, ${row.entityType}, ${row.entityKey},
                    ${attributesJson}::jsonb,
                    ${row.validFrom}::timestamptz, ${row.validTo}::timestamptz, NOW(),
                    ${row.confidence}, ${evidenceArray}::text[], ${row.source})
            ON CONFLICT DO NOTHING`,
      );
      return { id: row.id };
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
    const mod = (await import('@borjie/database')) as {
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
