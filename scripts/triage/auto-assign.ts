#!/usr/bin/env node
/**
 * auto-assign.ts — suggest an assignee for a pilot-triage GitHub issue.
 *
 * Takes a GitHub issue URL, fetches the stack trace from the body,
 * infers the affected area from file-path prefixes in the trace,
 * and matches against a CODEOWNERS-style internal map.
 *
 * Output is markdown the user pastes into a Slack thread or the
 * issue itself. No mutations — assigning is a human decision.
 *
 * Usage:
 *   pnpm tsx scripts/triage/auto-assign.ts \
 *     --issue=https://github.com/borjie/borjie/issues/123
 *
 * Environment:
 *   GITHUB_TOKEN     required — a token with read:issue scope
 *
 * Exit codes:
 *   0 — success (suggestion printed)
 *   1 — fatal (network, parse failure)
 *   2 — usage / validation error
 */

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// CODEOWNERS-style map: a path prefix (substring on `filename` field of
// stack frames) → owners. Order matters: first match wins.
// ---------------------------------------------------------------------------

interface OwnerEntry {
  readonly prefix: string;
  readonly area: string;
  readonly primary: string;
  readonly backup: string;
}

export const OWNER_MAP: ReadonlyArray<OwnerEntry> = Object.freeze([
  // Auth / OTP
  { prefix: 'packages/auth/', area: 'auth', primary: '@auth-team-primary', backup: '@auth-team-backup' },
  { prefix: 'supabase/', area: 'auth', primary: '@auth-team-primary', backup: '@auth-team-backup' },
  // Brain / pipelines
  { prefix: 'packages/central-intelligence/', area: 'brain', primary: '@brain-team-primary', backup: '@brain-team-backup' },
  { prefix: 'packages/ai-copilot/', area: 'brain', primary: '@brain-team-primary', backup: '@brain-team-backup' },
  { prefix: 'packages/vision-pipeline/', area: 'vision', primary: '@vision-team-primary', backup: '@vision-team-backup' },
  // API gateway
  { prefix: 'services/api-gateway/', area: 'api-gateway', primary: '@gateway-team-primary', backup: '@gateway-team-backup' },
  // Payments / FX
  { prefix: 'services/payments-ledger/', area: 'payments', primary: '@payments-team-primary', backup: '@payments-team-backup' },
  { prefix: 'services/payments/', area: 'payments', primary: '@payments-team-primary', backup: '@payments-team-backup' },
  { prefix: 'packages/fx-rates/', area: 'fx', primary: '@payments-team-primary', backup: '@payments-team-backup' },
  // Database / migrations
  { prefix: 'packages/database/', area: 'database', primary: '@db-team-primary', backup: '@db-team-backup' },
  // Mobile
  { prefix: 'apps/workforce-mobile/', area: 'mobile', primary: '@mobile-team-primary', backup: '@mobile-team-backup' },
  { prefix: 'apps/buyer-mobile/', area: 'mobile', primary: '@mobile-team-primary', backup: '@mobile-team-backup' },
  // Web cockpits
  { prefix: 'apps/owner-web/', area: 'owner-web', primary: '@web-team-primary', backup: '@web-team-backup' },
  { prefix: 'apps/admin-web/', area: 'admin-web', primary: '@web-team-primary', backup: '@web-team-backup' },
  // Sync / offline
  { prefix: 'packages/sync-engine/', area: 'sync', primary: '@sync-team-primary', backup: '@sync-team-backup' },
  // Workers
  { prefix: 'services/consolidation-worker/', area: 'worker', primary: '@worker-team-primary', backup: '@worker-team-backup' },
]);

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly help: boolean;
  readonly issueUrl: string | null;
}

const HELP = `
auto-assign.ts — suggest an assignee for a pilot-triage GitHub issue.

Usage:
  pnpm tsx scripts/triage/auto-assign.ts --issue=<github-url>

Options:
  --issue=<url>    GitHub issue URL (required).
  --help, -h       Show this help.

Environment:
  GITHUB_TOKEN     required — token with read:issue scope.
`;

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let help = false;
  let issueUrl: string | null = null;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg.startsWith('--issue=')) {
      issueUrl = arg.slice('--issue='.length);
      continue;
    }
  }
  return Object.freeze({ help, issueUrl });
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface IssueRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: string;
}

export function parseIssueUrl(url: string): IssueRef | null {
  // Accept both api.github.com/repos/.../issues/N and github.com/.../issues/N.
  const m =
    /https?:\/\/(?:api\.github\.com\/repos|github\.com)\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url);
  if (m === null) return null;
  const owner = m[1];
  const repo = m[2];
  const number = m[3];
  if (
    owner === undefined ||
    repo === undefined ||
    number === undefined
  ) {
    return null;
  }
  return Object.freeze({ owner, repo, number });
}

// ---------------------------------------------------------------------------
// File-path extraction from issue body
// ---------------------------------------------------------------------------

/**
 * Extracts file paths from a GitHub issue body that was filed by the
 * Sentry → GitHub bridge. The bridge's body format includes a
 * "Stack summary" block like:
 *
 *   1. `functionName` (path/to/file.ts:42)
 *   2. `otherFn` (other/path.ts:99)
 *
 * We pull every `(path:line)` between backticks-and-parens and return
 * the unique list, preserving first-seen order.
 */
export function extractFilePathsFromBody(body: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  const order: string[] = [];
  const re = /\(([^():\s]+(?:\/[^():\s]+)+)(?::\d+)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const path = m[1];
    if (path === undefined) continue;
    if (path.startsWith('<')) continue;
    if (!seen.has(path)) {
      seen.add(path);
      order.push(path);
    }
  }
  return Object.freeze(order);
}

// ---------------------------------------------------------------------------
// Owner inference
// ---------------------------------------------------------------------------

export interface OwnerSuggestion {
  readonly area: string;
  readonly primary: string;
  readonly backup: string;
  readonly matchedPath: string;
}

export function inferOwners(
  paths: ReadonlyArray<string>,
): ReadonlyArray<OwnerSuggestion> {
  const suggestions: OwnerSuggestion[] = [];
  const seenAreas = new Set<string>();
  for (const path of paths) {
    for (const entry of OWNER_MAP) {
      if (!path.includes(entry.prefix)) continue;
      if (seenAreas.has(entry.area)) continue;
      seenAreas.add(entry.area);
      suggestions.push(
        Object.freeze({
          area: entry.area,
          primary: entry.primary,
          backup: entry.backup,
          matchedPath: path,
        }),
      );
      break; // First matching prefix wins per-path.
    }
  }
  return Object.freeze(suggestions);
}

// ---------------------------------------------------------------------------
// GitHub fetch
// ---------------------------------------------------------------------------

async function fetchIssueBody(ref: IssueRef): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error('GITHUB_TOKEN is not set.');
  }
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { readonly body?: string; readonly title?: string };
  return body.body ?? '';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderSuggestion(
  ref: IssueRef,
  paths: ReadonlyArray<string>,
  suggestions: ReadonlyArray<OwnerSuggestion>,
): string {
  const lines: string[] = [];
  lines.push(`## Suggested assignment — ${ref.owner}/${ref.repo}#${ref.number}`);
  lines.push('');
  if (suggestions.length === 0) {
    lines.push('_No matching CODEOWNER prefix found. Triage manually._');
    lines.push('');
    lines.push('**File paths seen in stack:**');
    for (const path of paths.slice(0, 5)) {
      lines.push(`- \`${path}\``);
    }
    return lines.join('\n');
  }

  lines.push('| Area | Primary | Backup | First matched file |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of suggestions) {
    lines.push(
      `| \`${s.area}\` | ${s.primary} | ${s.backup} | \`${s.matchedPath}\` |`,
    );
  }
  lines.push('');
  const primaries = [...new Set(suggestions.map((s) => s.primary))].join(' ');
  lines.push(
    `**Paste-ready Slack ping:** \`${primaries} pls triage ${ref.owner}/${ref.repo}#${ref.number}\``,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.issueUrl === null) {
    process.stderr.write('Missing --issue=<url>. Run with --help.\n');
    return 2;
  }
  const ref = parseIssueUrl(args.issueUrl);
  if (ref === null) {
    process.stderr.write(`Could not parse issue URL: ${args.issueUrl}\n`);
    return 2;
  }

  const body = await fetchIssueBody(ref);
  const paths = extractFilePathsFromBody(body);
  const suggestions = inferOwners(paths);
  const md = renderSuggestion(ref, paths, suggestions);
  process.stdout.write(md + '\n');
  return 0;
}

const invokedAsCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (invokedAsCli) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(
        `[auto-assign] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}

export const __test = Object.freeze({
  parseArgs,
  parseIssueUrl,
  extractFilePathsFromBody,
  inferOwners,
  renderSuggestion,
});
