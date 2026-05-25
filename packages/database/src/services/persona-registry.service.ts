/**
 * Persona registry service — Drizzle-backed persistence for the
 * kernel's `PersonaRegistryStore` port (Phase D D7).
 *
 * Implements the three methods the kernel relies on:
 *
 *   - list()              : returns every persona row (platform + per-tenant)
 *   - upsert(persona)     : INSERT … ON CONFLICT id DO UPDATE
 *   - delete(name)        : DELETE by primary key; returns true on hit
 *
 * Returns the kernel's `PersonaIdentity` shape so the registry can
 * deep-clone without re-shaping. All errors caught + logged + degraded
 * — a missing DB row never bubbles up as a 500 for the brain.
 */

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { personaRegistry } from '../schemas/persona-registry.schema.js';
import { logger } from '../logger.js';


/**
 * Mirrors the kernel's `PersonaIdentity` shape. Duplicated here so the
 * database package does not pick up a compile-time dependency on
 * `@borjie/central-intelligence`.
 */
export interface PersistedPersonaIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly openingStatement: string;
  readonly toneGuidance: string;
  readonly taboos: ReadonlyArray<string>;
  readonly violationSignals: ReadonlyArray<string>;
  readonly firstPersonNoun: string;
}

export interface PersonaRegistryService {
  list(): Promise<ReadonlyArray<PersistedPersonaIdentity>>;
  upsert(
    persona: PersistedPersonaIdentity,
  ): Promise<PersistedPersonaIdentity>;
  delete(id: string): Promise<boolean>;
}

export function createPersonaRegistryService(
  db: DatabaseClient,
): PersonaRegistryService {
  return {
    async list() {
      try {
        const rows = await db
          .select()
          .from(personaRegistry);
        return (rows as ReadonlyArray<Record<string, unknown>>).map(toPersona);
      } catch (error) {
        logger.error('persona-registry.list failed', { error: error });
        return [];
      }
    },

    async upsert(persona) {
      try {
        if (!persona.id || persona.id.length === 0) {
          throw new Error('persona-registry.upsert: id is required');
        }
        const insertRow = {
          id: persona.id,
          tenantId: null,
          displayName: persona.displayName,
          openingStatement: persona.openingStatement,
          toneGuidance: persona.toneGuidance,
          taboos: [...persona.taboos],
          violationSignals: [...persona.violationSignals],
          firstPersonNoun: persona.firstPersonNoun,
          updatedAt: new Date(),
        } as Record<string, unknown>;

        // INSERT … ON CONFLICT (id) DO UPDATE pattern via drizzle.
        await db
          .insert(personaRegistry)
          .values(insertRow as never)
          .onConflictDoUpdate({
            target: personaRegistry.id,
            set: {
              displayName: persona.displayName,
              openingStatement: persona.openingStatement,
              toneGuidance: persona.toneGuidance,
              taboos: [...persona.taboos],
              violationSignals: [...persona.violationSignals],
              firstPersonNoun: persona.firstPersonNoun,
              updatedAt: new Date(),
            } as never,
          });
        return persona;
      } catch (error) {
        logger.error('persona-registry.upsert failed', { error: error });
        return persona;
      }
    },

    async delete(id) {
      try {
        const result = await db
          .delete(personaRegistry)
          .where(eq(personaRegistry.id, id))
          .returning();
        return Array.isArray(result) && result.length > 0;
      } catch (error) {
        logger.error('persona-registry.delete failed', { error: error });
        return false;
      }
    },
  };
}

function toPersona(row: Record<string, unknown>): PersistedPersonaIdentity {
  return {
    id: String(row.id ?? randomUUID()),
    displayName: String(row.displayName ?? row.display_name ?? ''),
    openingStatement: String(
      row.openingStatement ?? row.opening_statement ?? '',
    ),
    toneGuidance: String(row.toneGuidance ?? row.tone_guidance ?? ''),
    taboos: toStringArray(row.taboos),
    violationSignals: toStringArray(
      row.violationSignals ?? row.violation_signals,
    ),
    firstPersonNoun: String(
      row.firstPersonNoun ?? row.first_person_noun ?? 'I',
    ),
  };
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // fall through
    }
  }
  return [];
}
