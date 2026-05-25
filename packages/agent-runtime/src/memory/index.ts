/**
 * File-based agent memory — Claude Code MEMORY.md compatible.
 *
 * Layout (per Anthropic 2.1.59 auto-memory release):
 *
 *   ~/.claude/projects/<encoded-project-path>/memory/
 *     MEMORY.md                  ← index, one line per topical file
 *     preferences-coding.md      ← topical entries with frontmatter
 *     fact-build-command.md
 *     workflow-deploy.md
 *
 * Where `<encoded-project-path>` is the absolute project path with
 * `/` replaced by `-` and the leading slash dropped — the same
 * encoding Claude Code's `--debug` output reveals.
 *
 * `MEMORY.md` is the discovery surface (cheap, always read at session
 * start). Each topical file is `.md` with YAML frontmatter so the
 * round-trip is lossless.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MemoryEntry, MemoryIndex, RuntimeLogger } from '../types.js';
import { noopLogger } from '../types.js';
import { parseFrontmatter } from '../frontmatter.js';

export interface MemoryStoreOptions {
  readonly projectPath: string;
  readonly memoryRoot?: string;
  readonly logger?: RuntimeLogger;
}

export class MemoryStore {
  readonly #projectPath: string;
  readonly #memoryDir: string;
  readonly #logger: RuntimeLogger;
  readonly #indexPath: string;

  constructor(opts: MemoryStoreOptions) {
    this.#projectPath = opts.projectPath;
    this.#memoryDir = getMemoryDir(opts.projectPath, opts.memoryRoot);
    this.#indexPath = join(this.#memoryDir, 'MEMORY.md');
    this.#logger = opts.logger ?? noopLogger;
  }

  getMemoryDir(): string {
    return this.#memoryDir;
  }

  /**
   * Reads MEMORY.md + every topical `.md` and returns the typed entries.
   * If the dir doesn't exist yet, returns an empty index.
   */
  async readMemoryIndex(): Promise<MemoryIndex> {
    if (!existsSync(this.#memoryDir)) {
      return Object.freeze({ entries: Object.freeze([]), indexPath: this.#indexPath });
    }
    const files = await readdir(this.#memoryDir);
    const entries: MemoryEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue;
      const name = file.replace(/\.md$/, '');
      try {
        const entry = await this.#readEntryFile(name);
        if (entry !== undefined) entries.push(entry);
      } catch (err) {
        this.#logger.log('warn', `agent-runtime: skip unreadable memory ${file}`, {
          error: (err as Error).message,
        });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return Object.freeze({ entries: Object.freeze(entries), indexPath: this.#indexPath });
  }

  /**
   * Writes (or overwrites) a topical memory entry and refreshes MEMORY.md.
   */
  async writeMemoryEntry(entry: {
    readonly name: string;
    readonly type: MemoryEntry['type'];
    readonly content: string;
    readonly tags?: ReadonlyArray<string>;
    readonly source?: string;
  }): Promise<MemoryEntry> {
    await mkdir(this.#memoryDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const filePath = this.#entryPath(entry.name);
    const frontmatter = serialiseFrontmatter({
      type: entry.type,
      createdAt,
      ...(entry.tags !== undefined && entry.tags.length > 0 ? { tags: entry.tags } : {}),
      ...(entry.source !== undefined ? { source: entry.source } : {}),
    });
    const file = `${frontmatter}\n${entry.content.trim()}\n`;
    await writeFile(filePath, file, 'utf8');
    const written: MemoryEntry = Object.freeze({
      name: entry.name,
      type: entry.type,
      content: entry.content.trim(),
      ...(entry.tags !== undefined ? { tags: Object.freeze([...entry.tags]) } : {}),
      createdAt,
      ...(entry.source !== undefined ? { source: entry.source } : {}),
    });
    await this.#rewriteIndex();
    return written;
  }

  /** Simple substring/regex grep over the bodies (case-insensitive). */
  async searchMemory(query: string): Promise<ReadonlyArray<MemoryEntry>> {
    const idx = await this.readMemoryIndex();
    if (query.length === 0) return idx.entries;
    const needle = query.toLowerCase();
    let pattern: RegExp | undefined;
    try {
      pattern = new RegExp(query, 'i');
    } catch {
      // not a regex — fall through to substring match.
    }
    return Object.freeze(
      idx.entries.filter((e) => {
        const hay = `${e.name} ${e.content} ${(e.tags ?? []).join(' ')}`.toLowerCase();
        return (
          hay.includes(needle) ||
          (pattern !== undefined && pattern.test(`${e.name} ${e.content}`))
        );
      }),
    );
  }

  /** Removes a topical entry + refreshes MEMORY.md. */
  async forgetMemory(name: string): Promise<boolean> {
    const path = this.#entryPath(name);
    if (!existsSync(path)) return false;
    await unlink(path);
    await this.#rewriteIndex();
    return true;
  }

  // ───────────────────────── internals ─────────────────────────

  async #readEntryFile(name: string): Promise<MemoryEntry | undefined> {
    const path = this.#entryPath(name);
    try {
      const s = await stat(path);
      if (!s.isFile()) return undefined;
    } catch {
      return undefined;
    }
    const raw = await readFile(path, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const type = String(data['type'] ?? 'fact') as MemoryEntry['type'];
    const createdAt = String(data['createdAt'] ?? new Date(0).toISOString());
    const tags = Array.isArray(data['tags']) ? (data['tags'] as ReadonlyArray<string>) : undefined;
    const source = typeof data['source'] === 'string' ? (data['source'] as string) : undefined;
    return Object.freeze({
      name,
      type,
      content: body,
      ...(tags !== undefined ? { tags: Object.freeze([...tags]) } : {}),
      createdAt,
      ...(source !== undefined ? { source } : {}),
    });
  }

  #entryPath(name: string): string {
    if (!isSafeName(name)) {
      throw new Error(`unsafe memory name: ${name}`);
    }
    return join(this.#memoryDir, `${name}.md`);
  }

  /** Writes MEMORY.md as a table of contents over every topical file. */
  async #rewriteIndex(): Promise<void> {
    const idx = await this.readMemoryIndex();
    const lines: string[] = ['# Memory index', '', `> Project: \`${this.#projectPath}\``, ''];
    for (const e of idx.entries) {
      const tagLabel = e.tags !== undefined && e.tags.length > 0 ? ` (${e.tags.join(', ')})` : '';
      lines.push(`- [${e.name}](./${e.name}.md) — **${e.type}**${tagLabel}`);
    }
    if (idx.entries.length === 0) {
      lines.push('_(no entries yet)_');
    }
    await writeFile(this.#indexPath, `${lines.join('\n')}\n`, 'utf8');
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Resolves `~/.claude/projects/<encoded>/memory/` for `projectPath`.
 * Mirrors Claude Code's path encoding: leading-slash stripped, every
 * `/` replaced with `-`.
 */
export function getMemoryDir(projectPath: string, memoryRoot?: string): string {
  const root = memoryRoot ?? join(homedir(), '.claude', 'projects');
  const encoded = encodeProjectPath(projectPath);
  return join(root, encoded, 'memory');
}

export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/^\//, '').replace(/[/\\]/g, '-');
}

function isSafeName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.includes('..');
}

function serialiseFrontmatter(data: Readonly<Record<string, unknown>>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${String(item)}`);
    } else if (typeof v === 'string') {
      // Quote if value contains a colon to keep the parser happy on round-trip.
      const needsQuote = v.includes(':');
      lines.push(`${k}: ${needsQuote ? `"${v}"` : v}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}
