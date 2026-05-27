/**
 * Sentry → GitHub Issues bridge (Wave PILOT-TRIAGE).
 *
 * Polls (or accepts a push from) the Sentry Issues API for new
 * pilot-tagged errors and materialises each into a GitHub Issue so
 * the on-call engineer has one canonical thread per fingerprint.
 *
 * Goal (Days 6-10 of the Tanzania pilot): error → GitHub Issue → on-call
 * assignment → known runbook attached in under 5 minutes.
 *
 * ---------------------------------------------------------------------
 * Architecture
 * ---------------------------------------------------------------------
 *
 *   - All side-effects (Sentry fetch, GitHub create, DB upsert) are
 *     abstracted behind ports. Business logic compiles + tests without
 *     touching `octokit`, `@borjie/database` or `node:fetch`.
 *
 *   - Idempotent on `sentry_fingerprint`: if the bridge sees a
 *     fingerprint already in `pilot_issue_links`, it reuses the
 *     existing GitHub issue URL and returns `{ status: 'duplicate' }`
 *     instead of creating a second issue. Without this guarantee a
 *     ten-user pilot day surfaces 10× duplicate issues for the same
 *     "OTP not received" bug.
 *
 *   - Runbook linking: a static map (`runbook-fingerprint-map`)
 *     translates well-known Sentry fingerprints to the appropriate
 *     `Docs/runbooks/<slug>.md` entry. The bridge embeds the runbook
 *     link in the issue body and stores the slug for later analytics.
 *
 *   - Octokit-optional: `@octokit/rest` is NOT in the worker's
 *     dependency list (kept out to avoid bloating the worker bundle
 *     when the bridge isn't enabled). The default GitHub adapter
 *     dynamically requires it at runtime; if the package is absent the
 *     factory throws a typed `GitHubClientUnavailableError` at
 *     composition time, so the worker still compiles and starts in
 *     environments where pilot triage isn't wired.
 *
 * ---------------------------------------------------------------------
 * Operational contract
 * ---------------------------------------------------------------------
 *
 *   - `bridgeSentryIssueToGitHub(input, deps)` → `BridgeResult`
 *     - `{ status: 'created', githubIssueUrl, issueNumber, runbookSlug }`
 *     - `{ status: 'duplicate', githubIssueUrl, existingFingerprint }`
 *     - throws `SentryBridgeError` (typed) on adapter errors. The
 *       caller logs + re-queues; no errors are silently swallowed.
 *
 *   - Severity mapping: Sentry's `level` → GitHub label `severity:{level}`.
 *     `fatal` / `error` map to P0/P1 per `Docs/ON_CALL.md`.
 *
 *   - Pilot scoping: events without a `pilot_cohort:*` tag are
 *     ignored (returned as `{ status: 'skipped', reason: 'no-cohort' }`).
 *     This keeps prod-tenant errors out of the pilot issue tracker.
 */

import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Public types — Sentry event shape (subset we care about)
// ─────────────────────────────────────────────────────────────────────

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface SentryStackFrame {
  readonly filename?: string;
  readonly function?: string;
  readonly lineno?: number;
}

export interface SentryEventInput {
  /** Stable fingerprint — SHA of the normalised stack frame. */
  readonly fingerprint: string;
  /** Sentry-side issue id (e.g. `4123`), used for permalinks. */
  readonly issueId: string;
  /** Sentry-side org/project slugs for permalinks. */
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly level: SentryLevel;
  readonly errorType: string;
  readonly errorValue: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly stackFrames: ReadonlyArray<SentryStackFrame>;
  /** SHA-256 of the affected user id, never the raw id. */
  readonly userIdHash?: string;
  readonly screenId?: string;
  readonly sessionContext?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Ports (adapter-free business logic)
// ─────────────────────────────────────────────────────────────────────

export interface PilotIssueLinkRow {
  readonly sentryFingerprint: string;
  readonly githubIssueUrl: string;
  readonly githubIssueNumber: number;
  readonly cohort: string;
  readonly severity: SentryLevel;
  readonly runbookSlug: string | null;
}

export interface PilotIssueLinkStore {
  /** Returns the existing row if a duplicate fingerprint is present. */
  findByFingerprint(fingerprint: string): Promise<PilotIssueLinkRow | null>;
  /** Inserts a fresh row. Caller has already checked for duplicates. */
  insert(row: PilotIssueLinkRow): Promise<void>;
}

export interface GitHubIssueClient {
  /** Creates a new issue. Returns the canonical HTML URL + issue number. */
  createIssue(input: {
    readonly title: string;
    readonly body: string;
    readonly labels: ReadonlyArray<string>;
  }): Promise<{ readonly url: string; readonly number: number }>;
}

export interface BridgeClock {
  now(): Date;
}

// ─────────────────────────────────────────────────────────────────────
// Result + error types
// ─────────────────────────────────────────────────────────────────────

export type BridgeResult =
  | {
      readonly status: 'created';
      readonly fingerprint: string;
      readonly githubIssueUrl: string;
      readonly issueNumber: number;
      readonly runbookSlug: string | null;
      readonly cohort: string;
      readonly severity: SentryLevel;
    }
  | {
      readonly status: 'duplicate';
      readonly fingerprint: string;
      readonly githubIssueUrl: string;
      readonly existingIssueNumber: number;
    }
  | {
      readonly status: 'skipped';
      readonly fingerprint: string;
      readonly reason: 'no-cohort' | 'unsupported-level';
    };

export class SentryBridgeError extends Error {
  public readonly code:
    | 'github-create-failed'
    | 'store-lookup-failed'
    | 'store-insert-failed'
    | 'invalid-input';
  public override readonly cause: unknown;

  constructor(
    code: SentryBridgeError['code'],
    message: string,
    cause: unknown = null,
  ) {
    super(message);
    this.name = 'SentryBridgeError';
    this.code = code;
    this.cause = cause;
  }
}

export class GitHubClientUnavailableError extends Error {
  constructor(reason: string) {
    super(`@octokit/rest is not installed: ${reason}`);
    this.name = 'GitHubClientUnavailableError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Runbook map — static, append-only
// ─────────────────────────────────────────────────────────────────────

/**
 * Maps a Sentry fingerprint *prefix* (or stable tag value) to a
 * runbook slug under `Docs/runbooks/`. The map is intentionally
 * append-only — removing an entry would silently un-link previously
 * filed issues from their runbooks.
 *
 * Match strategy: substring of `errorType` OR exact match against the
 * `runbook_slug` tag if Sentry was configured to inject one. New
 * runbook authors add an entry here when they publish a runbook.
 */
export const RUNBOOK_BY_ERROR_TYPE: ReadonlyArray<{
  readonly errorTypePattern: string;
  readonly slug: string;
}> = [
  { errorTypePattern: 'AuthOtpNotReceived', slug: 'mobile-auth-otp-not-received' },
  { errorTypePattern: 'AuthOtpWrongCode', slug: 'mobile-auth-otp-wrong-code' },
  { errorTypePattern: 'AuthOtpExpired', slug: 'mobile-auth-otp-wrong-code' },
  { errorTypePattern: 'VisionEndpoint500', slug: 'vision-endpoint-500' },
  { errorTypePattern: 'VisionAdvisor500', slug: 'vision-endpoint-500' },
  { errorTypePattern: 'CorpusCitationsEmpty', slug: 'corpus-citations-empty' },
  { errorTypePattern: 'CorpusZeroRows', slug: 'corpus-citations-empty' },
  { errorTypePattern: 'GpsPermissionDenied', slug: 'gps-permission-denied' },
  { errorTypePattern: 'LocationPermissionDenied', slug: 'gps-permission-denied' },
  { errorTypePattern: 'OfflineSyncStuck', slug: 'offline-sync-queue-stuck' },
  { errorTypePattern: 'EnqueueWriteQueueFull', slug: 'offline-sync-queue-stuck' },
  { errorTypePattern: 'PersonaBindingLost', slug: 'persona-binding-lost-on-reload' },
  { errorTypePattern: 'PersonaContextEmpty', slug: 'persona-binding-lost-on-reload' },
  { errorTypePattern: 'PdfExportTimeout', slug: 'pdf-export-timeout' },
  { errorTypePattern: 'NetworkFlapping', slug: 'network-mobile-data-flapping' },
  { errorTypePattern: 'NetworkOfflineRetryExhausted', slug: 'network-mobile-data-flapping' },
  { errorTypePattern: 'FxRateUnavailable', slug: 'usd-tzs-conversion-failure' },
  { errorTypePattern: 'FxConversionFailed', slug: 'usd-tzs-conversion-failure' },
];

export function resolveRunbookSlug(event: SentryEventInput): string | null {
  const tagged = event.tags.runbook_slug;
  if (typeof tagged === 'string' && tagged.length > 0) {
    return tagged;
  }
  for (const entry of RUNBOOK_BY_ERROR_TYPE) {
    if (event.errorType.includes(entry.errorTypePattern)) {
      return entry.slug;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (cohort extraction, label inference, body assembly)
// ─────────────────────────────────────────────────────────────────────

export function extractCohort(event: SentryEventInput): string | null {
  const direct = event.tags.pilot_cohort;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  // Look for `pilot_cohort:<name>` in a generic `tags` flat string if
  // the source delivered a list-encoded form.
  return null;
}

export function inferLabels(
  event: SentryEventInput,
  cohort: string,
): ReadonlyArray<string> {
  const labels: string[] = ['pilot', `cohort:${cohort}`, `severity:${event.level}`];
  const runbookSlug = resolveRunbookSlug(event);
  if (runbookSlug !== null) {
    labels.push(`runbook:${runbookSlug}`);
  }
  if (event.screenId !== undefined && event.screenId.length > 0) {
    labels.push(`screen:${event.screenId}`);
  }
  return Object.freeze(labels);
}

export function buildIssueTitle(
  event: SentryEventInput,
  cohort: string,
): string {
  const truncatedValue = event.errorValue.length > 100
    ? event.errorValue.slice(0, 97) + '...'
    : event.errorValue;
  return `[PILOT][${cohort}] ${event.errorType}: ${truncatedValue}`;
}

export function buildIssueBody(
  event: SentryEventInput,
  runbookSlug: string | null,
): string {
  const sentryUrl =
    `https://sentry.io/organizations/${event.orgSlug}/issues/${event.issueId}/`;
  const stackSummary = event.stackFrames
    .slice(0, 8)
    .map((f, i) => {
      const fn = f.function ?? '<anonymous>';
      const loc = f.filename !== undefined
        ? `${f.filename}:${f.lineno ?? '?'}`
        : '<unknown>';
      return `  ${i + 1}. \`${fn}\` (${loc})`;
    })
    .join('\n');

  const lines: string[] = [
    `## Sentry origin`,
    ``,
    `- Sentry issue: ${sentryUrl}`,
    `- Fingerprint: \`${event.fingerprint}\``,
    `- Level: \`${event.level}\``,
    `- Error type: \`${event.errorType}\``,
    ``,
    `## Error value`,
    ``,
    `\`\`\``,
    event.errorValue,
    `\`\`\``,
    ``,
    `## Stack summary (top 8 frames)`,
    ``,
    stackSummary.length > 0 ? stackSummary : '_(no stack frames)_',
    ``,
    `## Pilot context`,
    ``,
    `- User id (hashed): \`${event.userIdHash ?? 'unknown'}\``,
    `- Screen id: \`${event.screenId ?? 'unknown'}\``,
    `- Session context:`,
    ``,
    `\`\`\`json`,
    JSON.stringify(event.sessionContext ?? {}, null, 2),
    `\`\`\``,
    ``,
  ];

  if (runbookSlug !== null) {
    lines.push(`## Known-error runbook`, ``);
    lines.push(
      `A known-error runbook exists for this fingerprint: ` +
      `[\`Docs/runbooks/${runbookSlug}.md\`](../Docs/runbooks/${runbookSlug}.md).`,
    );
    lines.push(``);
    lines.push(`Start there before diagnosing further.`);
    lines.push(``);
  } else {
    lines.push(`## Known-error runbook`, ``);
    lines.push(
      `_No runbook is currently mapped to this fingerprint. ` +
      `Once root-caused, add a new runbook under \`Docs/runbooks/\` and ` +
      `wire it into \`RUNBOOK_BY_ERROR_TYPE\` in ` +
      `\`services/consolidation-worker/src/tasks/sentry-to-github.ts\`._`,
    );
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(
    `_Filed automatically by the Sentry → GitHub bridge ` +
    `(see \`Docs/ON_CALL.md\` for triage SLAs)._`,
  );

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Main entrypoint
// ─────────────────────────────────────────────────────────────────────

export interface BridgeDeps {
  readonly store: PilotIssueLinkStore;
  readonly github: GitHubIssueClient;
  readonly clock?: BridgeClock;
}

/**
 * Idempotently file a Sentry pilot event into GitHub.
 *
 * Contract:
 *   - If the event has no `pilot_cohort` tag → `{ status: 'skipped' }`.
 *   - If the fingerprint is already in `pilot_issue_links` → reuses the
 *     existing GitHub issue and returns `{ status: 'duplicate' }`.
 *   - Otherwise creates a new GitHub issue, writes the link row, and
 *     returns `{ status: 'created' }`.
 *
 * Errors are typed (`SentryBridgeError`) — never silently swallowed.
 */
export async function bridgeSentryIssueToGitHub(
  event: SentryEventInput,
  deps: BridgeDeps,
): Promise<BridgeResult> {
  if (event.fingerprint.length === 0) {
    throw new SentryBridgeError('invalid-input', 'fingerprint is empty');
  }

  const cohort = extractCohort(event);
  if (cohort === null) {
    logger.info('sentry-to-github: skipped — no pilot_cohort tag', {
      fingerprint: event.fingerprint,
    });
    return Object.freeze({
      status: 'skipped' as const,
      fingerprint: event.fingerprint,
      reason: 'no-cohort' as const,
    });
  }

  let existing: PilotIssueLinkRow | null;
  try {
    existing = await deps.store.findByFingerprint(event.fingerprint);
  } catch (err) {
    throw new SentryBridgeError(
      'store-lookup-failed',
      `pilot_issue_links lookup failed for ${event.fingerprint}`,
      err,
    );
  }

  if (existing !== null) {
    logger.info('sentry-to-github: duplicate — re-using existing issue', {
      fingerprint: event.fingerprint,
      githubIssueUrl: existing.githubIssueUrl,
    });
    return Object.freeze({
      status: 'duplicate' as const,
      fingerprint: event.fingerprint,
      githubIssueUrl: existing.githubIssueUrl,
      existingIssueNumber: existing.githubIssueNumber,
    });
  }

  const runbookSlug = resolveRunbookSlug(event);
  const title = buildIssueTitle(event, cohort);
  const body = buildIssueBody(event, runbookSlug);
  const labels = inferLabels(event, cohort);

  let issue: { readonly url: string; readonly number: number };
  try {
    issue = await deps.github.createIssue({ title, body, labels });
  } catch (err) {
    throw new SentryBridgeError(
      'github-create-failed',
      `octokit createIssue failed for fingerprint ${event.fingerprint}`,
      err,
    );
  }

  const row: PilotIssueLinkRow = Object.freeze({
    sentryFingerprint: event.fingerprint,
    githubIssueUrl: issue.url,
    githubIssueNumber: issue.number,
    cohort,
    severity: event.level,
    runbookSlug,
  });

  try {
    await deps.store.insert(row);
  } catch (err) {
    // Critical: the GitHub issue exists but our index doesn't. Log
    // loudly so on-call cleans up the duplicate next time. We do NOT
    // attempt to delete the issue — manual cleanup is safer than risking
    // a double-mutation race.
    logger.error(
      'sentry-to-github: GitHub issue created but pilot_issue_links insert failed — ' +
      'manual de-duplication may be required',
      {
        fingerprint: event.fingerprint,
        githubIssueUrl: issue.url,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    throw new SentryBridgeError(
      'store-insert-failed',
      `pilot_issue_links insert failed for ${event.fingerprint} ` +
      `(GitHub issue ${issue.url} created but unindexed)`,
      err,
    );
  }

  logger.info('sentry-to-github: created GitHub issue', {
    fingerprint: event.fingerprint,
    cohort,
    severity: event.level,
    runbookSlug: runbookSlug ?? null,
    githubIssueUrl: issue.url,
  });

  return Object.freeze({
    status: 'created' as const,
    fingerprint: event.fingerprint,
    githubIssueUrl: issue.url,
    issueNumber: issue.number,
    runbookSlug,
    cohort,
    severity: event.level,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Default Octokit-backed GitHub client (optional dependency)
// ─────────────────────────────────────────────────────────────────────

export interface OctokitClientOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
}

/**
 * Resolves an `@octokit/rest` client at runtime. If the package is not
 * installed, throws `GitHubClientUnavailableError`. Callers in the
 * worker's composition root should catch this and disable the bridge
 * (so the worker still boots in environments where pilot triage isn't
 * wired).
 *
 * This is a thin adapter — the business logic above does not depend on
 * the shape of `@octokit/rest`.
 */
export async function createOctokitGitHubClient(
  opts: OctokitClientOptions,
): Promise<GitHubIssueClient> {
  if (opts.token.length === 0) {
    throw new GitHubClientUnavailableError('GITHUB_TOKEN is empty');
  }
  if (opts.owner.length === 0 || opts.repo.length === 0) {
    throw new GitHubClientUnavailableError('owner/repo is empty');
  }

  let OctokitCtor: new (config: { auth: string }) => unknown;
  try {
    // Dynamic import keeps the worker compilable when `@octokit/rest`
    // is not in the workspace dependency list. The cast is necessary
    // because we deliberately don't type-import the optional package.
    const mod = (await import('@octokit/rest' as string)) as {
      readonly Octokit?: new (config: { auth: string }) => unknown;
    };
    if (typeof mod.Octokit !== 'function') {
      throw new GitHubClientUnavailableError(
        '@octokit/rest does not export Octokit',
      );
    }
    OctokitCtor = mod.Octokit;
  } catch (err) {
    if (err instanceof GitHubClientUnavailableError) {
      throw err;
    }
    throw new GitHubClientUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const client = new OctokitCtor({ auth: opts.token }) as {
    readonly rest: {
      readonly issues: {
        create(params: {
          readonly owner: string;
          readonly repo: string;
          readonly title: string;
          readonly body: string;
          readonly labels: ReadonlyArray<string>;
        }): Promise<{
          readonly data: { readonly html_url: string; readonly number: number };
        }>;
      };
    };
  };

  return Object.freeze({
    async createIssue(input) {
      const result = await client.rest.issues.create({
        owner: opts.owner,
        repo: opts.repo,
        title: input.title,
        body: input.body,
        labels: input.labels,
      });
      return { url: result.data.html_url, number: result.data.number };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Test-only re-exports — kept under `__internal` so production
// callers never touch them.
// ─────────────────────────────────────────────────────────────────────

export const __internal = Object.freeze({
  extractCohort,
  inferLabels,
  buildIssueTitle,
  buildIssueBody,
  resolveRunbookSlug,
});
