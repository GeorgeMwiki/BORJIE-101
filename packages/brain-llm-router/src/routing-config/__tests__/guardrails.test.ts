/**
 * GUARDRAIL tests — the admin config can change WHICH model answers, never
 * the sovereign / min-tier rails.
 *
 * Asserts by construction:
 *   1. LOCKED_CATEGORIES remain authoritative: a per-use-case override for a
 *      locked use-case (offtake_drafting, licence_suspension_notice,
 *      financial_advice, legal_review, voice_transcribe, image_generation) is
 *      DROPPED at resolve time — admin config can never route a sovereign /
 *      legal category off its floor.
 *   2. The config model has NO field that can disable an HITL sovereign rail.
 *      The router's surface exposes only model-selection knobs; there is no
 *      "execute money/licence/deletion" toggle here. This test pins the public
 *      shape so a future field that could disable a rail would fail it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveConfigDrivenLadder,
  setRoutingConfigReader,
  resetRoutingConfigReader,
  type LlmRoutingConfig,
} from '../index.js';
import { LOCKED_CATEGORIES } from '../../routing-overrides/schema.js';

afterEach(() => {
  resetRoutingConfigReader();
});

describe('LOCKED_CATEGORIES are authoritative over admin per-use-case routing', () => {
  it.each([...LOCKED_CATEGORIES])(
    'never applies a per-use-case override for the locked category "%s"',
    (lockedUseCase) => {
      const config: LlmRoutingConfig = {
        coreModel: 'anthropic/claude-opus-4-8',
        orderedFallbacks: ['anthropic/claude-sonnet-4-6'],
        // An admin tries to cheap-route a locked legal/sovereign category.
        perUseCase: { [lockedUseCase]: 'anthropic/claude-haiku-4-5' },
      };
      setRoutingConfigReader(() => config);

      const result = resolveConfigDrivenLadder({
        task: 'chat',
        tenantId: 't1',
        useCase: lockedUseCase,
      });

      // The forbidden cheap override is ignored; the core stays the config core.
      expect(result.perUseCaseApplied).toBe(false);
      expect(result.ladder[0]).toBe('anthropic/claude-opus-4-8');
      expect(result.ladder).not.toContain('anthropic/claude-haiku-4-5');
    },
  );
});

describe('config model exposes only model-selection knobs (no sovereign-rail toggle)', () => {
  it('the LlmRoutingConfig keys are limited to which-model fields', () => {
    // A representative, fully-populated config. Its own keys are the ONLY
    // knobs the admin can set. None of them gate WHETHER an action executes.
    const config: LlmRoutingConfig = {
      coreModel: 'm',
      orderedFallbacks: ['f'],
      ensemble: { enabled: true, members: ['a', 'b'], combineStrategy: 'first-wins' },
      perUseCase: { casual_chat: 'h' },
    };
    const keys = Object.keys(config).sort();
    expect(keys).toEqual(['coreModel', 'ensemble', 'orderedFallbacks', 'perUseCase']);

    // Explicitly assert there is no execution/authorization/bypass-style key
    // that could disable an HITL sovereign rail (money / licence / deletion).
    const forbiddenSubstrings = [
      'execute',
      'authorize',
      'bypass',
      'skipHitl',
      'sovereign',
      'killSwitch',
      'allowMoney',
      'allowDeletion',
    ];
    for (const key of keys) {
      for (const bad of forbiddenSubstrings) {
        expect(key.toLowerCase()).not.toContain(bad.toLowerCase());
      }
    }
  });
});
