/**
 * Shared imports + helpers for the per-domain junior-output schema
 * files. Every junior-output table follows the same shape:
 *   id text PK, tenant_id text NOT NULL FK→tenants(id) ON DELETE CASCADE,
 *   junior-specific scalars, optional summary jsonb, created_at/computed_at.
 *
 * Splitting into per-domain files keeps each schema module under the
 * 300-line ceiling without losing the `junior-outputs/*` namespace.
 */

export {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';
export { tenants } from '../tenant.schema.js';
