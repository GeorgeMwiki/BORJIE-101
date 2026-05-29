/**
 * `borjie sessions ls / show / resume / archive / new` — multi-session
 * conversation management. Sessions are persisted locally so the CLI
 * stays useful even when the server is unreachable.
 */

import { activeProfileName } from './_session.js';
import {
  archiveSession,
  listSessions,
  loadSession,
  mostRecentSessionId,
  newSession,
  touchSession,
} from '../sessions.js';
import type { BorjieLogger } from '../logger.js';

export async function sessionsLsCommand(opts: {
  readonly logger: BorjieLogger;
  readonly all?: boolean;
}): Promise<void> {
  const sessions = listSessions({ includeArchived: opts.all === true });
  if (opts.logger.opts.json) {
    opts.logger.envelope({ ok: true, data: sessions });
    return;
  }
  if (sessions.length === 0) {
    opts.logger.info('(no sessions)');
    return;
  }
  opts.logger.raw('ID\tLAST USED\tTURNS\tLANG\tTITLE');
  for (const s of sessions) {
    opts.logger.raw(
      `${s.id}\t${s.lastUsedAt}\t${s.turns}\t${s.language}\t${s.title ?? '(untitled)'}`,
    );
  }
}

export async function sessionsShowCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
}): Promise<void> {
  const s = loadSession(opts.id);
  if (!s) {
    opts.logger.error(`No session "${opts.id}".`);
    process.exitCode = 1;
    return;
  }
  opts.logger.envelope({ ok: true, data: s, text: JSON.stringify(s, null, 2) });
}

export async function sessionsResumeCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id?: string;
}): Promise<string | null> {
  const id = opts.id ?? mostRecentSessionId();
  if (!id) {
    opts.logger.error('No sessions to resume. Start one with `borjie chat "<prompt>"`.');
    process.exitCode = 1;
    return null;
  }
  const s = touchSession(id);
  if (!s) {
    opts.logger.error(`No session "${id}".`);
    process.exitCode = 1;
    return null;
  }
  if (opts.logger.opts.json) {
    opts.logger.envelope({ ok: true, data: s });
  } else {
    opts.logger.success(`Resumed session ${id}. Pass --session ${id} to subsequent chat calls.`);
  }
  return id;
}

export async function sessionsArchiveCommand(opts: {
  readonly logger: BorjieLogger;
  readonly id: string;
}): Promise<void> {
  const s = archiveSession(opts.id);
  if (!s) {
    opts.logger.error(`No session "${opts.id}".`);
    process.exitCode = 1;
    return;
  }
  opts.logger.envelope({ ok: true, data: s, text: `Archived session ${opts.id}.` });
}

export async function sessionsNewCommand(opts: {
  readonly logger: BorjieLogger;
  readonly title?: string;
  readonly language?: 'sw' | 'en';
}): Promise<string> {
  const profile = activeProfileName();
  const language = opts.language ?? 'sw';
  const s = newSession({
    profile,
    language,
    ...(opts.title ? { title: opts.title } : {}),
  });
  if (opts.logger.opts.json) {
    opts.logger.envelope({ ok: true, data: s });
  } else {
    opts.logger.success(`Created session ${s.id} (${language}).`);
  }
  return s.id;
}
