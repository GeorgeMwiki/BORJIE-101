/**
 * Tests for the real on-device router pipeline (R-FUTURE-1 ship).
 *
 * Six tests covering:
 *   1. Falls back to server when model files are missing.
 *   2. Falls back to server when optional dep is missing.
 *   3. Routes on-device when both files + dep are present AND confident.
 *   4. Falls back to server on low confidence with router hint.
 *   5. Returns `server-error` path when fetch fails.
 *   6. Model-loader cache returns the same pipeline twice.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  routeOnDeviceAsync,
  isModelOnDisk,
  loadOnDeviceModel,
  resetModelCache,
  type OnDevicePipeline,
} from '../src/index';

function seedModelDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'borjie-models-'));
  const modelRoot = join(root, 'minilm-l6-v2');
  mkdirSync(modelRoot, { recursive: true });
  writeFileSync(join(modelRoot, 'model.onnx'), 'onnx-bytes');
  writeFileSync(join(modelRoot, 'tokenizer.json'), '{}');
  writeFileSync(join(modelRoot, 'tokenizer_config.json'), '{}');
  writeFileSync(join(modelRoot, 'config.json'), '{}');
  return modelRoot;
}

function noopLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
  };
}

afterEach(() => {
  resetModelCache();
});

describe('routeOnDeviceAsync', () => {
  it('falls back to server when model files are missing', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { toolId: 'srv', source: 'server' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const logger = noopLogger();
    const decision = await routeOnDeviceAsync('hi', {
      loader: { modelRoot: '/nonexistent/path/never' },
      fallback: { baseUrl: 'https://api.borjie.tz', fetcher },
      logger,
    });
    expect(decision.path).toBe('server-fallback');
    expect(decision.toolId).toBe('srv');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('falls back to server when the optional dep is missing', async () => {
    const modelRoot = seedModelDir();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { toolId: 'srv', source: 'server' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const decision = await routeOnDeviceAsync('hi', {
      loader: {
        modelRoot,
        importPipeline: async () => null,
      },
      fallback: { baseUrl: 'https://api.borjie.tz', fetcher },
      logger: noopLogger(),
    });
    expect(decision.path).toBe('server-fallback');
    expect(decision.toolId).toBe('srv');
    expect(decision.modelId).toBe('server');
  });

  it('routes on-device when files + dep present AND confidence high', async () => {
    const modelRoot = seedModelDir();
    const pipeline: OnDevicePipeline = {
      modelId: 'MiniLM-L6-v2-q8',
      classify: async () => ({ toolId: 'cockpit.daily-brief', confidence: 0.91 }),
    };
    const decision = await routeOnDeviceAsync('brief me', {
      loader: { modelRoot, fixedPipeline: pipeline },
      fallback: { baseUrl: 'https://api.borjie.tz', fetcher: vi.fn() },
      logger: noopLogger(),
    });
    expect(decision.path).toBe('on-device');
    expect(decision.toolId).toBe('cockpit.daily-brief');
    expect(decision.modelId).toBe('MiniLM-L6-v2-q8');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('falls back to server on low confidence with router hint', async () => {
    const modelRoot = seedModelDir();
    const pipeline: OnDevicePipeline = {
      modelId: 'MiniLM-L6-v2-q8',
      classify: async () => ({ toolId: 'maybe.tool', confidence: 0.4 }),
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { toolId: 'srv', source: 'server' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const decision = await routeOnDeviceAsync('ambiguous prompt', {
      loader: { modelRoot, fixedPipeline: pipeline },
      fallback: { baseUrl: 'https://api.borjie.tz', fetcher },
      logger: noopLogger(),
    });
    expect(decision.path).toBe('server-fallback');
    expect(decision.toolId).toBe('srv');
    const calledWith = fetcher.mock.calls[0]?.[1];
    expect(calledWith).toBeDefined();
    expect(JSON.parse(String(calledWith?.body))).toMatchObject({
      routerHint: { toolId: 'maybe.tool', confidence: 0.4 },
    });
  });

  it('returns server-error path when fetch throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const decision = await routeOnDeviceAsync('hi', {
      loader: { modelRoot: '/nonexistent' },
      fallback: { baseUrl: 'https://api.borjie.tz', fetcher },
      logger: noopLogger(),
    });
    expect(decision.path).toBe('server-error');
    expect(decision.toolId).toBeNull();
  });

  it('model-loader cache returns the same pipeline on subsequent calls', async () => {
    const modelRoot = seedModelDir();
    let calls = 0;
    const pipeline: OnDevicePipeline = {
      modelId: 'MiniLM-L6-v2-q8',
      classify: async () => ({ toolId: null, confidence: 0 }),
    };
    const importPipeline = async () => {
      calls += 1;
      return pipeline;
    };
    const first = await loadOnDeviceModel({ modelRoot, importPipeline });
    const second = await loadOnDeviceModel({ modelRoot });
    expect(first).toBe(pipeline);
    expect(second).toBe(pipeline);
    expect(calls).toBe(1);
  });
});

describe('isModelOnDisk', () => {
  it('returns false when root does not exist', () => {
    expect(isModelOnDisk('/path/that/does/not/exist/at/all')).toBe(false);
  });

  it('returns true when all four canonical files are present', () => {
    const modelRoot = seedModelDir();
    expect(isModelOnDisk(modelRoot)).toBe(true);
  });
});
