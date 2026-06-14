import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Dark-worker bypass-coverage guard (the structural guard the behavioral
 * dark-worker-service-role test cannot give).
 *
 * The four cross-tenant background workers scan/write FORCE-RLS tenant tables
 * over the service-role pool. Each such table MUST carry a
 * `<tbl>_service_role_bypass` policy or the worker's scan silently returns 0
 * rows (the reminders-class darkness). 0357 covered the WRITE-targets but
 * missed the READ-sources (ica-cert reads workforce_certifications;
 * entity-indexer reads licences/sites/document_drafts) — a false-green the
 * GUC-binding test sailed over. This pins the COMPLETE read+write table set so
 * a future worker that scans a new un-bypassed table fails the build here.
 *
 * When a cross-tenant worker starts reading/writing a new table, add it to the
 * list below AND ship its bypass migration — that deliberate edit is the point.
 */

// Every table the cross-tenant workers READ or WRITE. Source of the 0357/0358
// fixes; keep in lockstep with the worker SQL.
const WORKER_BYPASS_TABLES = [
  // ica-cert-expiry-cron
  'workforce_certifications', // read source  (0358)
  'workforce_cert_expiry_reminders', // write  (0357)
  'reminders', // write (also entity-indexer source) (0354)
  // compliance-deadline-scan
  'regulatory_filings', // read source = write-target (0357)
  // geofence-watcher
  'workforce_locations', // read source (0357)
  // entity-indexer-worker
  'licences', // read source (0358)
  'sites', // read source (0358)
  'document_drafts', // read source (0358)
  'entity_index', // write (0357)
  'entity_cross_references', // write (0357)
] as const

const MIGRATIONS_DIR = join(process.cwd(), 'packages/database/src/migrations')

/** Per-file SQL chunks of the forward migration chain. */
function migrationChunks(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .map((n) => readFileSync(join(MIGRATIONS_DIR, n), 'utf8'))
}

/**
 * A table is bypass-covered iff some migration file (a) names it as a literal
 * (`'tbl'`, the ARRAY/`:=` form used by 0342/0354/0357/0358) AND (b) creates a
 * `_service_role_bypass` policy keyed on `app.is_service_role`.
 */
function isBypassCovered(chunks: string[], tbl: string): boolean {
  // NB: the bypass migrations build the policy via `format('… ''app
  // .is_service_role'' …')`, so the file text carries DOUBLED quotes — match
  // the `is_service_role` token loosely rather than a specific quote form.
  return chunks.some(
    (c) =>
      c.includes(`'${tbl}'`) &&
      c.includes('_service_role_bypass') &&
      c.includes('is_service_role'),
  )
}

describe('dark-worker service-role bypass coverage (read + write tables)', () => {
  const chunks = migrationChunks()

  it('positive control: a table never granted a bypass is reported uncovered', () => {
    expect(isBypassCovered(chunks, '__definitely_not_a_real_table__')).toBe(false)
  })

  for (const tbl of WORKER_BYPASS_TABLES) {
    it(`${tbl} carries a service_role_bypass policy in the migration chain`, () => {
      expect(
        isBypassCovered(chunks, tbl),
        `${tbl} is scanned/written cross-tenant by a worker but has NO service_role_bypass migration — its scan will be dark under FORCE RLS`,
      ).toBe(true)
    })
  }
})
