/**
 * MigrationService — orchestrates extract → diff → approve → commit.
 *
 * The service is framework-agnostic. Transport (HTTP/chat) and parsing
 * live in their own layers. The AI copilot calls this service via the
 * refactored `migrationCommitTool.execute`.
 */

import type {
  IMigrationRepository,
  MigrationBundle,
} from './migration-repository.interface.js';
import type {
  MigrationCommittedEvent,
  MigrationRun,
  MigrationRunCounts,
} from './migration-run.js';

export interface EventBus {
  emit(event: MigrationCommittedEvent): Promise<void> | void;
}

export interface MigrationServiceDeps {
  readonly repository: IMigrationRepository;
  readonly eventBus?: EventBus;
  readonly now?: () => Date;
}

export type CommitError =
  | { code: 'RUN_NOT_FOUND'; message: string }
  | { code: 'INVALID_STATUS'; message: string }
  | { code: 'BUNDLE_MISSING'; message: string }
  | { code: 'WRITE_FAILED'; message: string };

export type CommitOk = {
  readonly ok: true;
  readonly run: MigrationRun;
  readonly counts: MigrationRunCounts;
  readonly skipped: Record<string, string[]>;
};

export type CommitResult = CommitOk | { readonly ok: false; readonly error: CommitError };

export class MigrationService {
  private readonly repo: IMigrationRepository;
  private readonly bus?: EventBus;
  private readonly now: () => Date;

  constructor(deps: MigrationServiceDeps) {
    this.repo = deps.repository;
    this.bus = deps.eventBus;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Commit a previously-approved run. Fails closed on:
   *   - run not found for tenant
   *   - run.status !== 'approved'
   *   - missing bundle
   *   - repository error (marks run 'failed', surfaces error)
   */
  async commit(params: {
    tenantId: string;
    runId: string;
    actorId: string;
  }): Promise<CommitResult> {
    const run = await this.repo.findRun(params.runId, params.tenantId);
    if (!run) {
      return {
        ok: false,
        error: { code: 'RUN_NOT_FOUND', message: `run ${params.runId} not found` },
      };
    }
    if (run.status !== 'approved') {
      return {
        ok: false,
        error: {
          code: 'INVALID_STATUS',
          message: `expected status=approved, got ${run.status}`,
        },
      };
    }
    if (!run.bundle) {
      return {
        ok: false,
        error: { code: 'BUNDLE_MISSING', message: 'run.bundle is null' },
      };
    }

    // Optimistic transition into committing so concurrent requests see it.
    await this.repo.updateStatus(run.id, run.tenantId, 'committing');

    let result;
    try {
      result = await this.repo.runInTransaction(
        run.tenantId,
        run.id,
        run.bundle as unknown as MigrationBundle
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateStatus(run.id, run.tenantId, 'failed', {
        errorMessage: message,
      });
      return { ok: false, error: { code: 'WRITE_FAILED', message } };
    }

    const committedAt = this.now().toISOString();
    const committed = await this.repo.updateStatus(
      run.id,
      run.tenantId,
      'committed',
      {
        committedSummary: result.counts,
        committedAt,
      }
    );

    if (this.bus) {
      await this.bus.emit({
        type: 'migration.committed',
        tenantId: run.tenantId,
        runId: run.id,
        counts: result.counts,
        committedAt,
        actorId: params.actorId,
      });
    }

    return {
      ok: true,
      run: committed,
      counts: result.counts,
      skipped: result.skipped,
    };
  }
}
