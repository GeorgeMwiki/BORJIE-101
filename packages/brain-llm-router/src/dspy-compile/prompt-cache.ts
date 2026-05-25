/**
 * Prompt cache — load/save `CompiledPrompt` JSON files.
 *
 * Layout (relative to package root):
 *
 *   compiled-prompts/
 *     <task-name>/
 *       <normalised-model>.json   <- e.g. claude-haiku-4-5.json
 *
 * Loaders are injected with a `Reader` (default: `fs/promises`) so tests
 * use an in-memory map. Same for writers.
 *
 * Cache misses are NOT auto-recompiled at runtime — they bubble up as
 * `PROMPT_CACHE_MISS`. The CI/deploy pipeline owns recompilation.
 */

import type { ModelTier } from '../types.js';
import type { CompiledPrompt } from './signature.js';
import { normaliseModelKey } from './normalise-key.js';

export interface CacheReader {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface CacheWriter {
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class PromptCacheMissError extends Error {
  constructor(
    public readonly taskName: string,
    public readonly model: ModelTier
  ) {
    super(`compiled prompt missing for task=${taskName} model=${model}`);
    this.name = 'PromptCacheMissError';
  }
}

export interface PromptCacheConfig {
  readonly baseDir: string;
  readonly reader: CacheReader;
  readonly writer?: CacheWriter;
}

export class PromptCache {
  constructor(private readonly config: PromptCacheConfig) {}

  /** Path for (taskName, model). */
  pathFor(taskName: string, model: ModelTier): string {
    const key = normaliseModelKey(model);
    return `${this.config.baseDir}/${taskName}/${key}.json`;
  }

  async load(taskName: string, model: ModelTier): Promise<CompiledPrompt> {
    const path = this.pathFor(taskName, model);
    if (!(await this.config.reader.exists(path))) {
      throw new PromptCacheMissError(taskName, model);
    }
    const raw = await this.config.reader.read(path);
    const parsed = JSON.parse(raw) as CompiledPrompt;
    return Object.freeze(parsed);
  }

  async save(compiled: CompiledPrompt): Promise<void> {
    if (this.config.writer === undefined) {
      throw new Error('PromptCache: writer not configured');
    }
    const path = this.pathFor(compiled.signatureName, compiled.model);
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.config.writer.mkdir(dir);
    await this.config.writer.write(path, JSON.stringify(compiled, null, 2));
  }
}

/**
 * In-memory reader/writer for tests + bootstrapping.
 */
export class InMemoryCacheStore implements CacheReader, CacheWriter {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`InMemory: ${path} not found`);
    return f;
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  // Test helpers
  has(path: string): boolean {
    return this.files.has(path);
  }
  dump(): readonly string[] {
    return [...this.files.keys()];
  }
}
