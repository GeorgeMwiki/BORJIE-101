/**
 * InMemorySkillFileSystem — deterministic test stub for SkillFileSystem.
 *
 * Tests build a virtual file tree via `addFile(path, content)` then run
 * discovery against it. No node:fs touched.
 */

import type { SkillFileSystem } from './types.js';

export class InMemorySkillFileSystem implements SkillFileSystem {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();

  addFile(path: string, content: string): void {
    this.files.set(this.normalize(path), content);
    // Ensure all ancestor directories exist.
    let dir = path;
    while (true) {
      const idx = dir.lastIndexOf('/');
      if (idx <= 0) break;
      dir = dir.slice(0, idx);
      this.dirs.add(this.normalize(dir));
    }
  }

  addDir(path: string): void {
    this.dirs.add(this.normalize(path));
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.dirs.has(this.normalize(path));
  }

  async isFile(path: string): Promise<boolean> {
    return this.files.has(this.normalize(path));
  }

  async readdir(path: string): Promise<ReadonlyArray<string>> {
    const norm = this.normalize(path);
    if (!this.dirs.has(norm)) {
      throw new Error(`InMemorySkillFileSystem: not a directory: ${path}`);
    }
    const prefix = norm + '/';
    const children = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const next = rest.split('/')[0];
        if (next !== undefined) children.add(next);
      }
    }
    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const rest = dirPath.slice(prefix.length);
        const next = rest.split('/')[0];
        if (next !== undefined && next !== '') children.add(next);
      }
    }
    return Array.from(children).sort();
  }

  async readFile(path: string): Promise<string> {
    const norm = this.normalize(path);
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`InMemorySkillFileSystem: file not found: ${path}`);
    }
    return content;
  }

  join(...segments: ReadonlyArray<string>): string {
    return segments.filter((s) => s !== '').join('/');
  }
}
