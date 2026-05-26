/**
 * Swahili glossary term repository — in-memory + SQL adapters.
 *
 * Tenant-scoped. The SQL adapter is parameterised on the canonical
 * `app.tenant_id` GUC pattern (migration 0049). The in-memory adapter
 * uses a Map keyed on (tenantId, term, register).
 */

import type {
  Register,
  SwahiliTermRow,
  SwahiliTermsRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

function key(tenantId: string, term: string, register: Register): string {
  return `${tenantId}::${term}::${register}`;
}

/**
 * In-memory `SwahiliTermsRepository`. Useful for tests + dev.
 */
export function createInMemorySwahiliTermsRepository(): SwahiliTermsRepository {
  const rows = new Map<string, SwahiliTermRow>();

  return Object.freeze({
    async insert(row: SwahiliTermRow): Promise<SwahiliTermRow> {
      const frozen: SwahiliTermRow = Object.freeze({ ...row });
      rows.set(key(row.tenantId, row.term, row.register), frozen);
      return frozen;
    },
    async lookupByTerm(
      tenantId: string,
      term: string,
      register?: Register,
    ): Promise<SwahiliTermRow | null> {
      if (register !== undefined) {
        return rows.get(key(tenantId, term, register)) ?? null;
      }
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.term === term) {
          return r;
        }
      }
      return null;
    },
    async listByDomain(
      tenantId: string,
      domain: string,
    ): Promise<ReadonlyArray<SwahiliTermRow>> {
      const out: SwahiliTermRow[] = [];
      for (const r of rows.values()) {
        if (r.tenantId === tenantId && r.domain === domain) {
          out.push(r);
        }
      }
      return Object.freeze(out);
    },
  });
}

interface RawTermsRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly tenant_id: string;
  readonly term: string;
  readonly lemma: string;
  readonly noun_class: number | null;
  readonly plural_class: number | null;
  readonly register: string;
  readonly domain: string;
  readonly en_equivalent: string;
  readonly definition: string;
  readonly citation: string;
  readonly created_at: string;
  readonly audit_hash: string;
}

function isValidRegister(r: string): r is Register {
  return r === 'formal' || r === 'colloquial' || r === 'sheng' || r === 'coastal' || r === 'bongo';
}

function mapRow(row: RawTermsRow): SwahiliTermRow {
  const defObj = JSON.parse(row.definition) as { sw: string; en: string };
  const citObj = JSON.parse(row.citation) as {
    url: string;
    title: string;
    accessedAt: string;
  };
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    term: row.term,
    lemma: row.lemma,
    nounClass: row.noun_class as SwahiliTermRow['nounClass'],
    pluralClass: row.plural_class as SwahiliTermRow['pluralClass'],
    register: isValidRegister(row.register) ? row.register : 'formal',
    domain: row.domain,
    enEquivalent: row.en_equivalent,
    definition: Object.freeze({ sw: defObj.sw, en: defObj.en }),
    citation: Object.freeze({
      url: citObj.url,
      title: citObj.title,
      accessedAt: citObj.accessedAt,
    }),
    createdAt: row.created_at,
    auditHash: row.audit_hash,
  });
}

/**
 * SQL-backed `SwahiliTermsRepository`. Issues parameterised SQL against
 * the `swahili_terms` table (migration 0049). RLS enforced upstream
 * via `app.tenant_id` GUC; we still pass tenant_id explicitly for
 * defence-in-depth.
 */
export function createSqlSwahiliTermsRepository(
  runner: SqlRunner,
): SwahiliTermsRepository {
  return Object.freeze({
    async insert(row: SwahiliTermRow): Promise<SwahiliTermRow> {
      const sql = `
        INSERT INTO swahili_terms (
          id, tenant_id, term, lemma, noun_class, plural_class,
          register, domain, en_equivalent, definition, citation,
          created_at, audit_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10::jsonb, $11::jsonb,
          $12, $13
        )
        RETURNING
          id, tenant_id, term, lemma, noun_class, plural_class,
          register, domain, en_equivalent,
          definition::text AS definition,
          citation::text   AS citation,
          created_at, audit_hash
      `;
      const result = await runner.execute<RawTermsRow>(sql, [
        row.id,
        row.tenantId,
        row.term,
        row.lemma,
        row.nounClass,
        row.pluralClass,
        row.register,
        row.domain,
        row.enEquivalent,
        JSON.stringify(row.definition),
        JSON.stringify(row.citation),
        row.createdAt,
        row.auditHash,
      ]);
      const head = result[0];
      if (head === undefined) {
        throw new Error('swahili_terms insert returned no row');
      }
      return mapRow(head);
    },
    async lookupByTerm(
      tenantId: string,
      term: string,
      register?: Register,
    ): Promise<SwahiliTermRow | null> {
      const baseSql = `
        SELECT
          id, tenant_id, term, lemma, noun_class, plural_class,
          register, domain, en_equivalent,
          definition::text AS definition,
          citation::text   AS citation,
          created_at, audit_hash
        FROM swahili_terms
        WHERE tenant_id = $1 AND term = $2
      `;
      const params: unknown[] = [tenantId, term];
      const sql =
        register !== undefined ? `${baseSql} AND register = $3 LIMIT 1` : `${baseSql} LIMIT 1`;
      if (register !== undefined) params.push(register);
      const rs = await runner.execute<RawTermsRow>(sql, params);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },
    async listByDomain(
      tenantId: string,
      domain: string,
    ): Promise<ReadonlyArray<SwahiliTermRow>> {
      const sql = `
        SELECT
          id, tenant_id, term, lemma, noun_class, plural_class,
          register, domain, en_equivalent,
          definition::text AS definition,
          citation::text   AS citation,
          created_at, audit_hash
        FROM swahili_terms
        WHERE tenant_id = $1 AND domain = $2
        ORDER BY created_at ASC
      `;
      const rs = await runner.execute<RawTermsRow>(sql, [tenantId, domain]);
      return Object.freeze(rs.map(mapRow));
    },
  });
}
