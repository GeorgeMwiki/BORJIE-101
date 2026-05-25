/**
 * VoyagerSkillLibrary — the in-memory skill index.
 *
 * Responsibilities:
 *   • Register skills (`register`)
 *   • Retrieve candidates for a situation (`retrieve`)
 *   • Execute the best candidate against the J1 entity-store
 *     (`executeFirstMatch`)
 *   • Update success/failure counters atomically after execution
 *     (`recordOutcome`) — including 3-consecutive-failure quarantine
 *
 * Immutability: skills are stored as plain records; updates return a new
 * record via spread (no mutation). This matches the global coding-style
 * rule.
 */

import type {
  CodeSkill,
  RetrievedSkill,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillSituation,
} from './types.js';
import { FAILURE_QUARANTINE_LIMIT } from './types.js';
import { retrieveSkills } from './retrieval.js';
import type { IEntityStoreService } from './entity-store-port.js';

export interface VoyagerLibraryOptions {
  /** Inject `now()` for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => Date;
}

export class VoyagerSkillLibrary {
  private skills = new Map<string, CodeSkill>();
  private readonly opts: Required<VoyagerLibraryOptions>;

  constructor(opts: VoyagerLibraryOptions = {}) {
    this.opts = { now: opts.now ?? (() => new Date()) };
  }

  size(): number {
    return this.skills.size;
  }

  register<TInput = unknown, TOutput = unknown>(
    skill: Omit<
      CodeSkill<TInput, TOutput>,
      'success_count' | 'failure_count' | 'consecutive_failures' | 'quarantined'
    > & Partial<Pick<CodeSkill<TInput, TOutput>, 'success_count' | 'failure_count' | 'consecutive_failures' | 'quarantined'>>
  ): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`[voyager-library] skill id "${skill.id}" already registered`);
    }
    const stored: CodeSkill<TInput, TOutput> = {
      ...skill,
      success_count: skill.success_count ?? 0,
      failure_count: skill.failure_count ?? 0,
      consecutive_failures: skill.consecutive_failures ?? 0,
      quarantined: skill.quarantined ?? false,
    } as CodeSkill<TInput, TOutput>;
    this.skills.set(skill.id, stored as CodeSkill);
  }

  get(id: string): CodeSkill | undefined {
    return this.skills.get(id);
  }

  all(): ReadonlyArray<CodeSkill> {
    return Array.from(this.skills.values());
  }

  retrieve(situation: SkillSituation): {
    readonly retrieve: ReadonlyArray<RetrievedSkill>;
    readonly top_3: ReadonlyArray<RetrievedSkill>;
    readonly scanned: number;
  } {
    return retrieveSkills(this.all(), situation);
  }

  /**
   * Find the top candidate and execute it. Returns the typed result PLUS
   * updates the success/failure ledger via `recordOutcome`.
   *
   * If no skill is above RETRIEVAL_THRESHOLD, returns an error result
   * with code `no_match` and the top-3 attached on `error.message` so
   * the caller can propose composition.
   */
  async executeFirstMatch<TInput = unknown, TOutput = unknown>(args: {
    readonly situation: SkillSituation;
    readonly input: TInput;
    readonly entity_store: IEntityStoreService;
    readonly correlation_id: string;
  }): Promise<SkillExecutionResult<TOutput>> {
    const { situation, input, entity_store, correlation_id } = args;
    const { retrieve, top_3 } = this.retrieve(situation);

    if (retrieve.length === 0) {
      return {
        skill_id: '',
        status: 'error',
        output: null,
        error: {
          code: 'no_match',
          message: `No skill above retrieval threshold; top-3 candidates: ${top_3
            .map((t) => `${t.skill.id}@${t.score.toFixed(3)}`)
            .join(', ')}`,
        },
        duration_ms: 0,
        correlation_id,
      };
    }

    const chosen = retrieve[0];
    if (!chosen) {
      return {
        skill_id: '',
        status: 'error',
        output: null,
        error: { code: 'no_match', message: 'retrieve list empty' },
        duration_ms: 0,
        correlation_id,
      };
    }

    const skill = chosen.skill as CodeSkill<TInput, TOutput>;
    const start = performance.now();
    const ctx: SkillExecutionContext = {
      entity_store,
      tenant_id: situation.tenant_id,
      jurisdiction: situation.jurisdiction,
      correlation_id,
      now: this.opts.now().toISOString(),
    };

    try {
      const output = await skill.code.run(ctx, input);
      const duration_ms = performance.now() - start;
      this.recordOutcome(skill.id, 'ok');
      return {
        skill_id: skill.id,
        status: 'ok',
        output,
        duration_ms,
        correlation_id,
      };
    } catch (err) {
      const duration_ms = performance.now() - start;
      this.recordOutcome(skill.id, 'error');
      return {
        skill_id: skill.id,
        status: 'error',
        output: null,
        error: {
          code: 'execution_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        duration_ms,
        correlation_id,
      };
    }
  }

  /**
   * Update the success/failure ledger for a skill, immutably.
   * Auto-quarantines after FAILURE_QUARANTINE_LIMIT consecutive failures.
   */
  recordOutcome(skillId: string, outcome: 'ok' | 'error'): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    const now_iso = this.opts.now().toISOString();
    if (outcome === 'ok') {
      const updated: CodeSkill = {
        ...skill,
        success_count: skill.success_count + 1,
        consecutive_failures: 0,
        last_used_at: now_iso,
      };
      this.skills.set(skillId, updated);
    } else {
      const nextConsec = skill.consecutive_failures + 1;
      const updated: CodeSkill = {
        ...skill,
        failure_count: skill.failure_count + 1,
        consecutive_failures: nextConsec,
        quarantined: skill.quarantined || nextConsec >= FAILURE_QUARANTINE_LIMIT,
        last_used_at: now_iso,
      };
      this.skills.set(skillId, updated);
    }
  }

  /** Manually unquarantine a skill (e.g. after operator review). */
  unquarantine(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    this.skills.set(skillId, {
      ...skill,
      quarantined: false,
      consecutive_failures: 0,
    });
  }
}
