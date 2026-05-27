#!/usr/bin/env node
/**
 * summarize-pilot-errors.ts — daily 1-screen markdown summary of pilot
 * errors, grouped by cohort + severity.
 *
 * Pulls from the pilot-errors dashboard endpoint (Agent 9's surface
 * at `/api/v1/pilot/errors`) and renders a markdown report that fits
 * on a single terminal screen. On-call paste into the daily standup.
 *
 * Output is markdown (no ANSI colours) so it's diffable, pasteable
 * into a GitHub comment, and survives a copy through Slack.
 *
 * Usage:
 *   pnpm tsx scripts/triage/summarize-pilot-errors.ts
 *   pnpm tsx scripts/triage/summarize-pilot-errors.ts --window=24h
 *   pnpm tsx scripts/triage/summarize-pilot-errors.ts --cohort=tz-pilot-1
 *   make pilot-summary
 *
 * Environment:
 *   BORJIE_API_BASE_URL   default: http://localhost:3001
 *   BORJIE_ADMIN_TOKEN    required — admin bearer token for the
 *                         pilot-errors endpoint
 *
 * Exit codes:
 *   0 — success
 *   1 — fatal (network, auth, parse failure)
 *   2 — usage / validation error
 */

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Types — kept narrow; the endpoint may grow but we only use what we render.
// ---------------------------------------------------------------------------

interface PilotErrorRow {
  readonly fingerprint: string;
  readonly errorType: string;
  readonly cohort: string;
  readonly severity: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  readonly count: number;
  readonly affectedUsers: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly runbookSlug: string | null;
  readonly githubIssueUrl: string | null;
}

interface PilotErrorsResponse {
  readonly success: boolean;
  readonly data?: {
    readonly window: string;
    readonly errors: ReadonlyArray<PilotErrorRow>;
    readonly totalUniqueFingerprints: number;
    readonly totalAffectedUsers: number;
  };
  readonly error?: { readonly message: string };
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly help: boolean;
  readonly window: string;
  readonly cohort: string | null;
}

const HELP = `
summarize-pilot-errors.ts — daily 1-screen pilot error summary.

Usage:
  pnpm tsx scripts/triage/summarize-pilot-errors.ts [options]

Options:
  --window=<duration>    Time window. Default 24h. Examples: 1h, 6h, 24h, 7d.
  --cohort=<name>        Filter to a single cohort.
  --help, -h             Show this help.

Environment:
  BORJIE_API_BASE_URL    Default http://localhost:3001
  BORJIE_ADMIN_TOKEN     Required.
`;

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let help = false;
  let window = '24h';
  let cohort: string | null = null;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg.startsWith('--window=')) {
      window = arg.slice('--window='.length);
      continue;
    }
    if (arg.startsWith('--cohort=')) {
      cohort = arg.slice('--cohort='.length);
      continue;
    }
  }

  return Object.freeze({ help, window, cohort });
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchPilotErrors(
  args: CliArgs,
): Promise<PilotErrorsResponse['data']> {
  const baseUrl = process.env.BORJIE_API_BASE_URL ?? 'http://localhost:3001';
  const token = process.env.BORJIE_ADMIN_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error(
      'BORJIE_ADMIN_TOKEN is not set. Export an admin bearer token before running.',
    );
  }

  const params = new URLSearchParams();
  params.set('window', args.window);
  if (args.cohort !== null) {
    params.set('cohort', args.cohort);
  }

  const url = `${baseUrl}/api/v1/pilot/errors?${params.toString()}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(
      `pilot-errors endpoint returned ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json()) as PilotErrorsResponse;
  if (!body.success || body.data === undefined) {
    throw new Error(
      `pilot-errors endpoint returned success=false: ${body.error?.message ?? 'unknown'}`,
    );
  }

  return body.data;
}

// ---------------------------------------------------------------------------
// Rendering — pure
// ---------------------------------------------------------------------------

interface GroupedBucket {
  readonly cohort: string;
  readonly severity: string;
  readonly rows: ReadonlyArray<PilotErrorRow>;
}

export function groupByCohortAndSeverity(
  rows: ReadonlyArray<PilotErrorRow>,
): ReadonlyArray<GroupedBucket> {
  const map = new Map<string, PilotErrorRow[]>();
  for (const row of rows) {
    const key = `${row.cohort}::${row.severity}`;
    const bucket = map.get(key) ?? [];
    bucket.push(row);
    map.set(key, bucket);
  }
  const sevOrder: ReadonlyArray<string> = ['fatal', 'error', 'warning', 'info', 'debug'];
  return Object.freeze(
    [...map.entries()]
      .map(([key, bucketRows]) => {
        const [cohort = '', severity = ''] = key.split('::');
        return { cohort, severity, rows: Object.freeze([...bucketRows]) };
      })
      .sort((a, b) => {
        if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
        return (
          sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
        );
      }),
  );
}

export function renderMarkdown(
  data: NonNullable<PilotErrorsResponse['data']>,
  asOf: Date,
): string {
  const buckets = groupByCohortAndSeverity(data.errors);
  const lines: string[] = [];

  lines.push(`# Pilot error summary — ${data.window}`);
  lines.push('');
  lines.push(`_Generated ${asOf.toISOString()}_`);
  lines.push('');
  lines.push(
    `**Totals:** ${data.totalUniqueFingerprints} unique fingerprints, ` +
    `${data.totalAffectedUsers} affected users.`,
  );
  lines.push('');

  if (buckets.length === 0) {
    lines.push('_No errors in window. Clean window — celebrate._');
    return lines.join('\n');
  }

  for (const bucket of buckets) {
    lines.push(`## ${bucket.cohort} — ${bucket.severity.toUpperCase()}`);
    lines.push('');
    lines.push('| Error | Users | Events | Runbook | Issue |');
    lines.push('| --- | ---: | ---: | --- | --- |');
    for (const row of bucket.rows) {
      const runbook = row.runbookSlug !== null
        ? `\`${row.runbookSlug}\``
        : '_(none)_';
      const issue = row.githubIssueUrl !== null
        ? `[#${(row.githubIssueUrl.split('/').pop() ?? '?')}](${row.githubIssueUrl})`
        : '_(unfiled)_';
      const errLabel = row.errorType.length > 40
        ? row.errorType.slice(0, 37) + '...'
        : row.errorType;
      lines.push(
        `| \`${errLabel}\` | ${row.affectedUsers} | ${row.count} | ${runbook} | ${issue} |`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'Paste this into the daily standup. On-call: triage P0/P1 first ' +
    '(fatal/error severity in the top cohort).',
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

  const data = await fetchPilotErrors(args);
  const md = renderMarkdown(data, new Date());
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
        `[summarize-pilot-errors] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}

export const __test = Object.freeze({ parseArgs, renderMarkdown, groupByCohortAndSeverity });
