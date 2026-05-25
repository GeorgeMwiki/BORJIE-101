import { describe, it, expect, afterEach } from 'vitest';
import { createProcessIntelServer } from '../src/index.js';
import { createMockSidecar } from './test-helpers.js';

describe('createProcessIntelServer', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('exposes the 9 tools and is constructed without spawning the real sidecar', () => {
    sidecar = createMockSidecar();
    const built = createProcessIntelServer({ pm4pyClient: sidecar.client });
    expect(built.tools).toHaveLength(9);
    expect(built.server).toBeDefined();
    expect(built.pm4py).toBe(sidecar.client);
  });
});
