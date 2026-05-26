/**
 * Swahili morphology cache repository — in-memory + SQL.
 *
 * Memoises morphological analyses keyed on (tenantId, surface form).
 */

import type {
  SwahiliMorphologyCacheRepository,
  SwahiliMorphologyCacheRow,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

function key(tenantId: string, surfaceForm: string): string {
  return `${tenantId}::${surfaceForm}`;
}

export function createInMemoryMorphologyCacheRepository(): SwahiliMorphologyCacheRepository {
  const rows = new Map<string, SwahiliMorphologyCacheRow>();
  return Object.freeze({
    async upsert(
      row: SwahiliMorphologyCacheRow,
    ): Promise<SwahiliMorphologyCacheRow> {
      const frozen: SwahiliMorphologyCacheRow = Object.freeze({
        ...row,
        morphemes: Object.freeze([...row.morphemes]),
        features: Object.freeze({ ...row.features }),
      });
      rows.set(key(row.tenantId, row.surfaceForm), frozen);
      return frozen;
    },
    async get(
      tenantId: string,
      surfaceForm: string,
    ): Promise<SwahiliMorphologyCacheRow | null> {
      return rows.get(key(tenantId, surfaceForm)) ?? null;
    },
  });
}

interface RawCacheRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly tenant_id: string;
  readonly surface_form: string;
  readonly lemma: string;
  readonly morphemes: string;
  readonly pos: string;
  readonly features: string;
  readonly confidence: number;
  readonly recorded_at: string;
  readonly audit_hash: string;
}

const POS_VALUES = [
  'noun',
  'verb',
  'adj',
  'adv',
  'pron',
  'num',
  'conj',
  'prep',
  'particle',
] as const;
type PosTagLocal = (typeof POS_VALUES)[number];

function isPosTag(s: string): s is PosTagLocal {
  return (POS_VALUES as ReadonlyArray<string>).includes(s);
}

function mapRow(row: RawCacheRow): SwahiliMorphologyCacheRow {
  const morphemes = JSON.parse(row.morphemes) as ReadonlyArray<{
    value: string;
    slot: string;
    gloss?: string;
  }>;
  const features = JSON.parse(row.features) as Record<string, unknown>;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    surfaceForm: row.surface_form,
    lemma: row.lemma,
    morphemes: Object.freeze(
      morphemes.map((m) =>
        Object.freeze({
          value: m.value,
          slot: m.slot as SwahiliMorphologyCacheRow['morphemes'][number]['slot'],
          ...(m.gloss !== undefined ? { gloss: m.gloss } : {}),
        }),
      ),
    ) as SwahiliMorphologyCacheRow['morphemes'],
    pos: isPosTag(row.pos) ? row.pos : 'particle',
    features: Object.freeze({ ...features }),
    confidence: Number(row.confidence),
    recordedAt: row.recorded_at,
    auditHash: row.audit_hash,
  });
}

export function createSqlMorphologyCacheRepository(
  runner: SqlRunner,
): SwahiliMorphologyCacheRepository {
  return Object.freeze({
    async upsert(
      row: SwahiliMorphologyCacheRow,
    ): Promise<SwahiliMorphologyCacheRow> {
      const sql = `
        INSERT INTO swahili_morphology_cache (
          id, tenant_id, surface_form, lemma, morphemes, pos,
          features, confidence, recorded_at, audit_hash
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6,
          $7::jsonb, $8, $9, $10
        )
        ON CONFLICT (tenant_id, surface_form) DO UPDATE
          SET lemma       = EXCLUDED.lemma,
              morphemes   = EXCLUDED.morphemes,
              pos         = EXCLUDED.pos,
              features    = EXCLUDED.features,
              confidence  = EXCLUDED.confidence,
              recorded_at = EXCLUDED.recorded_at,
              audit_hash  = EXCLUDED.audit_hash
        RETURNING
          id, tenant_id, surface_form, lemma,
          morphemes::text AS morphemes, pos,
          features::text  AS features, confidence,
          recorded_at, audit_hash
      `;
      const rs = await runner.execute<RawCacheRow>(sql, [
        row.id,
        row.tenantId,
        row.surfaceForm,
        row.lemma,
        JSON.stringify(row.morphemes),
        row.pos,
        JSON.stringify(row.features),
        row.confidence,
        row.recordedAt,
        row.auditHash,
      ]);
      const head = rs[0];
      if (head === undefined) {
        throw new Error('swahili_morphology_cache upsert returned no row');
      }
      return mapRow(head);
    },
    async get(
      tenantId: string,
      surfaceForm: string,
    ): Promise<SwahiliMorphologyCacheRow | null> {
      const sql = `
        SELECT
          id, tenant_id, surface_form, lemma,
          morphemes::text AS morphemes, pos,
          features::text  AS features, confidence,
          recorded_at, audit_hash
        FROM swahili_morphology_cache
        WHERE tenant_id = $1 AND surface_form = $2
        LIMIT 1
      `;
      const rs = await runner.execute<RawCacheRow>(sql, [tenantId, surfaceForm]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },
  });
}
