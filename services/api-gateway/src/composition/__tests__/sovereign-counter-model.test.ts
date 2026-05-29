/**
 * Sovereign counter-model wiring tests — Central Command Phase C (C1).
 *
 * Verifies the Phase C C1 hoist + counter-model wire-in done in
 * `sovereign.ts`:
 *
 *   1. The hoisted `loadAnthropicClient()` call sits ABOVE both
 *      `createExecutor({...})` literals so the wrapped `anthropic`
 *      client is in scope for both executor branches.
 *   2. Each `createExecutor({...})` literal threads
 *      `counterModel: createProductionCounterModel(anthropic)`.
 *   3. The `./critics/counter-model-wiring.js` import is present so
 *      the factory resolves at load time.
 *   4. The `createProductionCounterModel` factory itself behaves
 *      correctly: null in → null out (degraded mode); non-null in →
 *      a CounterModel instance (production mode).
 *
 * Two layers of assertion:
 *
 *   - SOURCE-LEVEL: parse `sovereign.ts` once and assert structural
 *     invariants (counter-model line appears twice; hoist precedes
 *     both executors). This is a regression guard against accidental
 *     deletion of either wire-in.
 *
 *   - BEHAVIOURAL: exercise `createProductionCounterModel` directly
 *     against a fake AnthropicMessagesClient — verifying the null-
 *     guard contract that the executor relies on.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  createProductionCounterModel,
  productionCounterModel,
} from '../critics/counter-model-wiring.js';

// ---------------------------------------------------------------------------
// SOURCE-LEVEL — verify the sovereign.ts wiring stays correct.
//
// Parsing source text instead of bytecode keeps the test fast and
// dep-free. The composition root itself is too dense to instantiate
// without a real DB; the structural assertion below is the cheapest
// regression guard available.
// ---------------------------------------------------------------------------

const SOVEREIGN_SOURCE = readFileSync(
  path.resolve(__dirname, '..', 'sovereign.ts'),
  'utf8',
);

const ANTHROPIC_LOAD_PATTERN = /const\s+anthropicRaw\s*=\s*await\s+loadAnthropicClient\(\)/;
const ANTHROPIC_WRAP_PATTERN = /const\s+anthropic\s*=\s*anthropicRaw/;
// R4 2026-05-29 — the C1 wire-in now factors the call out to a local
// `const counterModel = createProductionCounterModel(anthropic)` and
// then spreads `counterModel: ...` into the executor only when the
// value is non-null (so the executor input keeps its exactOptionalProperty
// contract). The regex now matches the factoring step rather than the
// inline shape.
const COUNTER_MODEL_FACTORY_LINE =
  /createProductionCounterModel\s*\(\s*anthropic\s*\)/g;
const CREATE_EXECUTOR_PATTERN = /agencyKernel\.createExecutor\(\{/g;
const IMPORT_PATTERN =
  /import\s+\{\s*createProductionCounterModel\s*\}\s+from\s+['"]\.\/critics\/counter-model-wiring\.js['"]/;

describe('sovereign.ts — counter-model wiring (Phase C C1)', () => {
  it('imports createProductionCounterModel from ./critics/counter-model-wiring.js', () => {
    expect(IMPORT_PATTERN.test(SOVEREIGN_SOURCE)).toBe(true);
  });

  it('hoists `loadAnthropicClient()` ABOVE both `createExecutor` call sites', () => {
    const loadIdx = SOVEREIGN_SOURCE.search(ANTHROPIC_LOAD_PATTERN);
    expect(loadIdx).toBeGreaterThan(-1);

    // Find every `createExecutor({` occurrence; lastIndex starts at 0.
    const executorMatches = matchAll(SOVEREIGN_SOURCE, CREATE_EXECUTOR_PATTERN);
    expect(executorMatches.length).toBe(2);
    for (const idx of executorMatches) {
      expect(idx).toBeGreaterThan(loadIdx);
    }
  });

  it('wraps the raw Anthropic client with the circuit-breaker BEFORE the executors', () => {
    const wrapIdx = SOVEREIGN_SOURCE.search(ANTHROPIC_WRAP_PATTERN);
    expect(wrapIdx).toBeGreaterThan(-1);
    const executorMatches = matchAll(SOVEREIGN_SOURCE, CREATE_EXECUTOR_PATTERN);
    for (const idx of executorMatches) {
      expect(idx).toBeGreaterThan(wrapIdx);
    }
  });

  it('calls `createProductionCounterModel(anthropic)` for BOTH executors (factored or inline)', () => {
    const matches = SOVEREIGN_SOURCE.match(COUNTER_MODEL_FACTORY_LINE);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(2);
  });

  it('legacy COORD ZONE comments have been removed', () => {
    // Two comment headers were left behind by B5 pending B2's hoist.
    // Removing them is the contract close-out for Phase C C1.
    expect(SOVEREIGN_SOURCE).not.toMatch(/COORD ZONE \(B5 → B2\)/);
  });
});

// ---------------------------------------------------------------------------
// BEHAVIOURAL — verify the factory contract the executor relies on.
// ---------------------------------------------------------------------------

describe('createProductionCounterModel — null-safety contract', () => {
  it('returns null when the anthropic client is null (degraded mode)', () => {
    expect(createProductionCounterModel(null)).toBeNull();
  });

  it('returns a CounterModel adapter when a client is supplied', () => {
    const fakeClient = makeFakeAnthropicClient();
    const cm = createProductionCounterModel(fakeClient);
    expect(cm).not.toBeNull();
    expect(typeof cm?.review).toBe('function');
  });

  it('exposes a named alias `productionCounterModel` matching the factory', () => {
    expect(productionCounterModel).toBe(createProductionCounterModel);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchAll(source: string, pattern: RegExp): number[] {
  const out: number[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m.index);
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

interface FakeAnthropicClient {
  messages: {
    create(args: unknown): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

function makeFakeAnthropicClient(): FakeAnthropicClient {
  return {
    messages: {
      async create() {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ verdict: 'approve', reason: 'ok' }),
            },
          ],
        };
      },
    },
  };
}
