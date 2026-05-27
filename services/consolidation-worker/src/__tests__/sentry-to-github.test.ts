/**
 * sentry-to-github bridge tests — Wave PILOT-TRIAGE.
 *
 * Coverage:
 *   1. Fingerprint deduplication — duplicate fingerprint → `{ status:
 *      'duplicate' }`, no GitHub call, no store insert.
 *   2. Label inference — labels include `pilot`, `cohort:*`,
 *      `severity:*`, `runbook:*` when a runbook is mapped.
 *   3. Runbook linking — fingerprint matching `AuthOtpNotReceived`
 *      resolves to `mobile-auth-otp-not-received` and embeds the
 *      runbook link in the issue body.
 *   4. Octokit error handling — `github.createIssue` throws →
 *      `SentryBridgeError('github-create-failed')`, no store insert.
 *   5. No-cohort skip — events without `pilot_cohort:*` tag → `{ status:
 *      'skipped' }`.
 *   6. Store insert-after-create failure — GitHub created but store
 *      insert failed → typed `store-insert-failed` error (no rollback
 *      of the GitHub issue, but a loud log).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  bridgeSentryIssueToGitHub,
  SentryBridgeError,
  type BridgeDeps,
  type GitHubIssueClient,
  type PilotIssueLinkRow,
  type PilotIssueLinkStore,
  type SentryEventInput,
  __internal,
} from '../tasks/sentry-to-github.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<SentryEventInput> = {},
): SentryEventInput {
  return Object.freeze({
    fingerprint: 'fp-abc-123',
    issueId: '42',
    orgSlug: 'borjie',
    projectSlug: 'workforce-mobile',
    level: 'error' as const,
    errorType: 'AuthOtpNotReceived',
    errorValue: 'OTP delivery timed out after 60s',
    tags: { pilot_cohort: 'tz-pilot-1', screen_id: 'auth.otp.entry' },
    stackFrames: [
      { filename: 'packages/auth/src/otp/send.ts', function: 'sendOtp', lineno: 87 },
      { filename: 'supabase/functions/auth.ts', function: 'handle', lineno: 23 },
    ],
    userIdHash: 'sha256-user-hash',
    screenId: 'auth.otp.entry',
    sessionContext: { app_version: '1.2.0' },
    ...overrides,
  });
}

function makeStore(): {
  readonly store: PilotIssueLinkStore;
  readonly insertedRows: ReadonlyArray<PilotIssueLinkRow>;
  readonly existingByFingerprint: Map<string, PilotIssueLinkRow>;
} {
  const insertedRows: PilotIssueLinkRow[] = [];
  const existingByFingerprint = new Map<string, PilotIssueLinkRow>();
  const store: PilotIssueLinkStore = {
    async findByFingerprint(fp) {
      return existingByFingerprint.get(fp) ?? null;
    },
    async insert(row) {
      insertedRows.push(row);
    },
  };
  return { store, insertedRows, existingByFingerprint };
}

function makeGitHub(
  result: { url: string; number: number } = {
    url: 'https://github.com/borjie/borjie/issues/999',
    number: 999,
  },
): {
  readonly github: GitHubIssueClient;
  readonly captured: ReadonlyArray<{
    title: string;
    body: string;
    labels: ReadonlyArray<string>;
  }>;
} {
  const captured: Array<{ title: string; body: string; labels: ReadonlyArray<string> }> = [];
  const github: GitHubIssueClient = {
    async createIssue(input) {
      captured.push({ title: input.title, body: input.body, labels: input.labels });
      return result;
    },
  };
  return { github, captured };
}

// ─────────────────────────────────────────────────────────────────────
// 1. Fingerprint dedup
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — fingerprint deduplication', () => {
  it('returns duplicate when fingerprint already in store', async () => {
    const event = makeEvent();
    const { store, existingByFingerprint, insertedRows } = makeStore();
    const { github, captured } = makeGitHub();
    existingByFingerprint.set(event.fingerprint, {
      sentryFingerprint: event.fingerprint,
      githubIssueUrl: 'https://github.com/borjie/borjie/issues/77',
      githubIssueNumber: 77,
      cohort: 'tz-pilot-1',
      severity: 'error',
      runbookSlug: 'mobile-auth-otp-not-received',
    });

    const deps: BridgeDeps = { store, github };
    const result = await bridgeSentryIssueToGitHub(event, deps);

    expect(result.status).toBe('duplicate');
    if (result.status === 'duplicate') {
      expect(result.githubIssueUrl).toBe('https://github.com/borjie/borjie/issues/77');
      expect(result.existingIssueNumber).toBe(77);
    }
    expect(captured).toHaveLength(0);
    expect(insertedRows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Label inference
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — label inference', () => {
  it('emits pilot, cohort:*, severity:*, and runbook:* labels', async () => {
    const event = makeEvent();
    const { store } = makeStore();
    const { github, captured } = makeGitHub();
    const result = await bridgeSentryIssueToGitHub(event, { store, github });

    expect(result.status).toBe('created');
    expect(captured).toHaveLength(1);
    const labels = captured[0]?.labels ?? [];
    expect(labels).toContain('pilot');
    expect(labels).toContain('cohort:tz-pilot-1');
    expect(labels).toContain('severity:error');
    expect(labels).toContain('runbook:mobile-auth-otp-not-received');
    expect(labels).toContain('screen:auth.otp.entry');
  });

  it('emits the correct title format', async () => {
    const event = makeEvent();
    const { store } = makeStore();
    const { github, captured } = makeGitHub();
    await bridgeSentryIssueToGitHub(event, { store, github });
    expect(captured[0]?.title).toBe(
      '[PILOT][tz-pilot-1] AuthOtpNotReceived: OTP delivery timed out after 60s',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Runbook linking
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — runbook linking', () => {
  it('resolves runbook slug for AuthOtpNotReceived', () => {
    const slug = __internal.resolveRunbookSlug(makeEvent());
    expect(slug).toBe('mobile-auth-otp-not-received');
  });

  it('embeds the runbook link in the issue body', async () => {
    const event = makeEvent();
    const { store } = makeStore();
    const { github, captured } = makeGitHub();
    await bridgeSentryIssueToGitHub(event, { store, github });
    expect(captured[0]?.body).toContain(
      'Docs/runbooks/mobile-auth-otp-not-received.md',
    );
  });

  it('honours an explicit runbook_slug tag override', () => {
    const event = makeEvent({
      tags: { pilot_cohort: 'tz-pilot-1', runbook_slug: 'custom-slug' },
    });
    expect(__internal.resolveRunbookSlug(event)).toBe('custom-slug');
  });

  it('returns null when no runbook is mapped', () => {
    const event = makeEvent({ errorType: 'ObscureWeirdErrorNoMappingYet' });
    expect(__internal.resolveRunbookSlug(event)).toBeNull();
  });

  it('writes runbookSlug into the store insert row', async () => {
    const event = makeEvent();
    const { store, insertedRows } = makeStore();
    const { github } = makeGitHub();
    await bridgeSentryIssueToGitHub(event, { store, github });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.runbookSlug).toBe('mobile-auth-otp-not-received');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Octokit error handling
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — octokit error handling', () => {
  it('throws SentryBridgeError(code=github-create-failed) when octokit throws', async () => {
    const event = makeEvent();
    const { store, insertedRows } = makeStore();
    const github: GitHubIssueClient = {
      async createIssue() {
        throw new Error('octokit-network-down');
      },
    };
    await expect(
      bridgeSentryIssueToGitHub(event, { store, github }),
    ).rejects.toMatchObject({
      name: 'SentryBridgeError',
      code: 'github-create-failed',
    });
    expect(insertedRows).toHaveLength(0);
  });

  it('throws SentryBridgeError(code=store-insert-failed) when store fails after octokit succeeds', async () => {
    const event = makeEvent();
    const store: PilotIssueLinkStore = {
      async findByFingerprint() { return null; },
      async insert() { throw new Error('unique-violation'); },
    };
    const { github } = makeGitHub();
    await expect(
      bridgeSentryIssueToGitHub(event, { store, github }),
    ).rejects.toMatchObject({
      name: 'SentryBridgeError',
      code: 'store-insert-failed',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. No-cohort skip
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — pilot cohort gating', () => {
  it('skips events without a pilot_cohort tag', async () => {
    const event = makeEvent({ tags: { other_tag: 'x' } });
    const { store, insertedRows } = makeStore();
    const { github, captured } = makeGitHub();
    const result = await bridgeSentryIssueToGitHub(event, { store, github });
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('no-cohort');
    }
    expect(captured).toHaveLength(0);
    expect(insertedRows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Invalid input
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — invalid input', () => {
  it('throws when fingerprint is empty', async () => {
    const event = makeEvent({ fingerprint: '' });
    const { store } = makeStore();
    const { github } = makeGitHub();
    await expect(
      bridgeSentryIssueToGitHub(event, { store, github }),
    ).rejects.toMatchObject({
      name: 'SentryBridgeError',
      code: 'invalid-input',
    });
  });

  it('wraps store-lookup errors with code=store-lookup-failed', async () => {
    const event = makeEvent();
    const store: PilotIssueLinkStore = {
      async findByFingerprint() { throw new Error('db-down'); },
      async insert() { /* never reached */ },
    };
    const { github } = makeGitHub();
    await expect(
      bridgeSentryIssueToGitHub(event, { store, github }),
    ).rejects.toMatchObject({
      name: 'SentryBridgeError',
      code: 'store-lookup-failed',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('sentry-to-github — pure helpers', () => {
  it('extractCohort returns the tag value', () => {
    expect(__internal.extractCohort(makeEvent())).toBe('tz-pilot-1');
  });

  it('extractCohort returns null when missing', () => {
    expect(__internal.extractCohort(makeEvent({ tags: {} }))).toBeNull();
  });

  it('inferLabels is immutable (frozen)', () => {
    const labels = __internal.inferLabels(makeEvent(), 'tz-pilot-1');
    expect(Object.isFrozen(labels)).toBe(true);
  });
});

// Suppress unused-import linting in case `vi` is not invoked.
void vi;
