/**
 * Shared fixture helpers — temp dirs + a mock brain.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrainPort, BrainRequest, BrainResponse } from '../../types.js';

export async function createTempDir(prefix = 'ocap-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanup(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export async function writeFixtureFile(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const target = join(root, relPath);
  const parent = target.slice(0, target.lastIndexOf('/'));
  if (parent && parent !== root) await mkdir(parent, { recursive: true });
  await writeFile(target, content, 'utf8');
}

export interface MockBrainOptions {
  readonly responses: ReadonlyArray<string>;
}

export interface MockBrainPort extends BrainPort {
  readonly calls: ReadonlyArray<BrainRequest>;
  readonly reset: () => void;
}

export function createMockBrain(options: MockBrainOptions): MockBrainPort {
  const responses = [...options.responses];
  const calls: BrainRequest[] = [];
  let idx = 0;
  const port: MockBrainPort = {
    calls,
    reset: () => {
      idx = 0;
      calls.length = 0;
    },
    generate: async (req: BrainRequest): Promise<BrainResponse> => {
      calls.push(req);
      const text = responses[idx] ?? '';
      idx++;
      return {
        text,
        usage: { inputTokens: req.prompt.length, outputTokens: text.length },
      };
    },
  };
  return port;
}
