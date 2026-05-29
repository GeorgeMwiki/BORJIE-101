/**
 * Brain-session persistence — each conversation thread is one JSON
 * file under `~/.config/borjie/sessions/<id>.json`.
 *
 * The CLI never *creates* a brain session on the server — it merely
 * records what session ids it has talked to, with metadata for
 * `borjie sessions ls`. The actual session lifecycle is owned by the
 * brain (see `services/api-gateway/...` → `brain/sessions`).
 *
 * If the server-side sessions endpoint is unavailable, the local
 * registry is the source of truth and remains usable offline.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ensureBorjieDir,
  sessionFilePath,
  sessionsDir,
} from './paths.js';

const FILE_MODE = 0o600;

export interface BorjieSession {
  readonly id: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly title?: string;
  readonly language: 'sw' | 'en';
  readonly turns: number;
  readonly profile: string;
  readonly archived: boolean;
}

export function newSession(args: {
  readonly profile: string;
  readonly language: 'sw' | 'en';
  readonly title?: string;
}): BorjieSession {
  ensureBorjieDir('sessions');
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: BorjieSession = Object.freeze({
    id,
    createdAt: now,
    lastUsedAt: now,
    ...(args.title ? { title: args.title } : {}),
    language: args.language,
    turns: 0,
    profile: args.profile,
    archived: false,
  });
  writeFileSync(sessionFilePath(id), JSON.stringify(session, null, 2), {
    mode: FILE_MODE,
  });
  return session;
}

export function touchSession(id: string, args?: { increment?: boolean }): BorjieSession | null {
  const existing = loadSession(id);
  if (!existing) return null;
  const updated: BorjieSession = Object.freeze({
    ...existing,
    lastUsedAt: new Date().toISOString(),
    turns: args?.increment ? existing.turns + 1 : existing.turns,
  });
  writeFileSync(sessionFilePath(id), JSON.stringify(updated, null, 2), {
    mode: FILE_MODE,
  });
  return updated;
}

export function loadSession(id: string): BorjieSession | null {
  const path = sessionFilePath(id);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<BorjieSession>;
    if (typeof raw.id !== 'string' || typeof raw.createdAt !== 'string') return null;
    return Object.freeze({
      id: raw.id,
      createdAt: raw.createdAt,
      lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : raw.createdAt,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      language: raw.language === 'en' ? 'en' : 'sw',
      turns: typeof raw.turns === 'number' ? raw.turns : 0,
      profile: typeof raw.profile === 'string' ? raw.profile : 'default',
      archived: raw.archived === true,
    });
  } catch {
    return null;
  }
}

export function listSessions(args?: { includeArchived?: boolean }): readonly BorjieSession[] {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const sessions: BorjieSession[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const s = loadSession(id);
    if (s && (args?.includeArchived || !s.archived)) sessions.push(s);
  }
  return sessions.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export function archiveSession(id: string): BorjieSession | null {
  const existing = loadSession(id);
  if (!existing) return null;
  const updated: BorjieSession = Object.freeze({ ...existing, archived: true });
  writeFileSync(sessionFilePath(id), JSON.stringify(updated, null, 2), {
    mode: FILE_MODE,
  });
  return updated;
}

export function deleteSession(id: string): boolean {
  const path = sessionFilePath(id);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function mostRecentSessionId(): string | null {
  const list = listSessions();
  return list[0]?.id ?? null;
}
