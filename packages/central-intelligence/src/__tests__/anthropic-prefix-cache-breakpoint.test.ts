/**
 * BRAIN §5 — Anthropic prompt-prefix cache breakpoint on the sensor seam.
 *
 * Proves the lazy-load brain win wires end-to-end:
 *   - `buildAnthropicSystemField` turns the kernel's segmented system prompt
 *     into an Anthropic `system` block array with a single `cache_control:
 *     ephemeral` (1h TTL) marker at the END of the stable persona + corpus
 *     prefix.
 *   - The terminal security layers stay LAST and never carry the marker.
 *   - Absent segments → byte-identical plain-string `system` (zero behaviour
 *     change for legacy callers).
 *   - The block texts concatenate back to the exact assembled string, so the
 *     model sees identical content whether or not the breakpoint is present.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSystemPrompt,
  assembleSystemPromptBlocks,
  buildAnthropicSystemField,
  createAnthropicSensor,
  IP_PROTECTION_LAYER,
  SECURITY_BOUNDARY_LAYER,
  type AnthropicMessagesClient,
  type AnthropicRequestMessage,
  type AnthropicSystemBlock,
  type AnthropicSystemField,
  type SensorCallArgs,
  type SystemFragments,
} from '../kernel/index.js';

const FRAGMENTS: SystemFragments = {
  personaPrelude: 'You are Mr. Mwikila, the brain layer of Borjie.',
  identity: 'Surface: owner cockpit.',
  rolloutPrompt: 'Rollout: cohort-A active.',
  moduleInventory: 'Modules: licences, royalty, treasury.',
  locus: 'Locus: tenant.',
  behaviouralDirective: 'Behavioural directive: be concise.',
  semanticMemory: 'Recalled: prefers TZS summaries.',
  grounding: 'grounding: royalty_rate = 6% (corpus)',
  cohortMix: 'Cohort: pilot.',
};

function argsFrom(fragments: SystemFragments): SensorCallArgs {
  return {
    system: assembleSystemPrompt(fragments),
    systemPrompt: assembleSystemPrompt(fragments),
    systemSegments: assembleSystemPromptBlocks(fragments),
    userMessage: 'What is my royalty rate?',
    priorTurns: [],
    extendedThinking: false,
    stakes: 'low',
  };
}

function isBlockArray(
  system: AnthropicSystemField | undefined,
): system is ReadonlyArray<AnthropicSystemBlock> {
  return Array.isArray(system);
}

describe('buildAnthropicSystemField — cache breakpoint placement', () => {
  it('returns a block array with exactly one cache_control marker', () => {
    const system = buildAnthropicSystemField(argsFrom(FRAGMENTS));
    expect(isBlockArray(system)).toBe(true);
    if (!isBlockArray(system)) return;
    const marked = system.filter((b) => b.cache_control !== undefined);
    expect(marked).toHaveLength(1);
  });

  it('marks the STABLE prefix block (persona + corpus), not the dynamic / security blocks', () => {
    const system = buildAnthropicSystemField(argsFrom(FRAGMENTS));
    if (!isBlockArray(system)) throw new Error('expected block array');
    const marked = system.find((b) => b.cache_control !== undefined)!;
    expect(marked.text).toContain('Mr. Mwikila');
    expect(marked.text).toContain('owner cockpit');
    expect(marked.text).toContain('Modules:');
    // Dynamic + security content must NOT be inside the cached block.
    expect(marked.text).not.toContain('royalty_rate');
    expect(marked.text).not.toContain('Recalled:');
    expect(marked.text).not.toContain('CONFIDENTIALITY');
    expect(marked.text).not.toContain('SECURITY BOUNDARY');
  });

  it('requests the longest TTL (1h) on the breakpoint', () => {
    const system = buildAnthropicSystemField(argsFrom(FRAGMENTS));
    if (!isBlockArray(system)) throw new Error('expected block array');
    const marked = system.find((b) => b.cache_control !== undefined)!;
    expect(marked.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('keeps the security layers as the LAST blocks, unmarked', () => {
    const system = buildAnthropicSystemField(argsFrom(FRAGMENTS));
    if (!isBlockArray(system)) throw new Error('expected block array');
    const last = system[system.length - 1]!;
    const penultimate = system[system.length - 2]!;
    expect(last.text).toBe(SECURITY_BOUNDARY_LAYER);
    expect(penultimate.text).toBe(IP_PROTECTION_LAYER);
    expect(last.cache_control).toBeUndefined();
    expect(penultimate.cache_control).toBeUndefined();
  });

  it('GOLDEN MASTER — block texts concatenate to the exact assembled system string', () => {
    const args = argsFrom(FRAGMENTS);
    const system = buildAnthropicSystemField(args);
    if (!isBlockArray(system)) throw new Error('expected block array');
    expect(system.map((b) => b.text).join('\n')).toBe(args.system);
  });

  it('falls back to the plain string when no segments are present (zero behaviour change)', () => {
    const args: SensorCallArgs = {
      system: 'legacy plain system',
      userMessage: 'hi',
      priorTurns: [],
      extendedThinking: false,
      stakes: 'low',
    };
    expect(buildAnthropicSystemField(args)).toBe('legacy plain system');
  });

  it('returns undefined for an empty system with no segments', () => {
    const args: SensorCallArgs = {
      system: '',
      userMessage: 'hi',
      priorTurns: [],
      extendedThinking: false,
      stakes: 'low',
    };
    expect(buildAnthropicSystemField(args)).toBeUndefined();
  });
});

describe('Anthropic sensor — sends the cache-marked system through messages.create', () => {
  it('forwards the block-array system with the breakpoint to the client', async () => {
    let capturedSystem: AnthropicSystemField | undefined;
    const client: AnthropicMessagesClient = {
      messages: {
        async create(callArgs: {
          model: string;
          system?: AnthropicSystemField;
          messages: ReadonlyArray<AnthropicRequestMessage>;
        }) {
          capturedSystem = callArgs.system;
          return {
            id: 'm1',
            model: callArgs.model,
            stop_reason: 'end_turn',
            content: [{ type: 'text' as const, text: 'ok' }],
          };
        },
      },
    };
    const sensor = createAnthropicSensor(client, {
      id: 'sonnet',
      modelId: 'claude-sonnet-4-6',
      priority: 1,
      capabilities: ['fast'],
    });

    await sensor.call(argsFrom(FRAGMENTS));

    expect(isBlockArray(capturedSystem)).toBe(true);
    if (!isBlockArray(capturedSystem)) return;
    const marked = capturedSystem.filter((b) => b.cache_control !== undefined);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.text).toContain('Mr. Mwikila');
    // Security boundary remains the terminal block.
    expect(capturedSystem[capturedSystem.length - 1]!.text).toBe(
      SECURITY_BOUNDARY_LAYER,
    );
  });
});
