/**
 * Caveat 4 — Cost-aware fallback ladder across 11 providers.
 *
 * Closes the Wave 18N gap: the dispatcher's fallback ladder was
 * hardcoded by capability (Runway → Sora → Seedance, Flux → Ideogram
 * → Recraft → Imagen → SD3.5) but ignored cost vs remaining budget.
 * On a tight class budget (e.g. briefing_thumbnail ≤ 10c) the
 * dispatcher would attempt Flux 1.1 (6c) first and could exceed the
 * envelope on subsequent recipe calls. Cost-aware reorder now sorts
 * by cheapest fitting provider, drops over-budget options, and
 * keeps canonical capability order as the tiebreaker.
 *
 * Persona: Mr. Mwikila (Managing Director).
 */

import { describe, expect, it } from 'vitest';
import {
  reorderForCapability,
  reorderForCapabilityAndCost,
  reorderForCost,
} from '../providers/dispatcher.js';
import type {
  MediaArtifact,
  MediaCapability,
  MediaProviderAdapter,
  MediaProviderId,
  MediaProviderInput,
} from '../types.js';

function adapter(
  provider_id: MediaProviderId,
  capabilities: ReadonlyArray<MediaCapability>,
  cost_cents: number,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: `fake-${provider_id}`,
    model_id: `${provider_id}-mock`,
    model_version: '0.0.1',
    provider_id,
    capabilities,
    cost_per_unit_usd_cents: cost_cents,
    applyBrandLock: (p) => p,
    invoke: async () => null,
  };
}

describe('Caveat 4 — reorderForCost picks cheapest first', () => {
  it('sorts adapters by cost asc', () => {
    const flux = adapter('flux', ['text_to_image'], 6);
    const imagen = adapter('imagen', ['text_to_image'], 4);
    const ideogram = adapter('ideogram', ['text_to_image'], 8);
    const result = reorderForCost([flux, imagen, ideogram], 100);
    expect(result.map((a) => a.provider_id)).toEqual([
      'imagen', // 4c
      'flux', //   6c
      'ideogram', // 8c
    ]);
  });

  it('drops adapters whose per-unit cost exceeds the remaining budget', () => {
    const cheap = adapter('imagen', ['text_to_image'], 4);
    const expensive = adapter('sora', ['text_to_video'], 1000);
    const result = reorderForCost([cheap, expensive], 50);
    expect(result.map((a) => a.provider_id)).toEqual(['imagen']);
  });

  it('preserves canonical (caller-supplied) order on cost ties', () => {
    const a = adapter('flux', ['text_to_image'], 6);
    const b = adapter('imagen', ['text_to_image'], 6);
    const c = adapter('ideogram', ['text_to_image'], 6);
    // Canonical order: flux, imagen, ideogram
    const result = reorderForCost([a, b, c], 100);
    expect(result.map((x) => x.provider_id)).toEqual([
      'flux',
      'imagen',
      'ideogram',
    ]);
  });

  it('returns an empty ladder when every adapter is over-budget', () => {
    const result = reorderForCost(
      [adapter('sora', ['text_to_video'], 1000)],
      50,
    );
    expect(result).toEqual([]);
  });

  it('handles a zero-budget edge case (every adapter dropped except cost-0)', () => {
    const free = adapter('sd35', ['text_to_image'], 0);
    const paid = adapter('flux', ['text_to_image'], 6);
    const result = reorderForCost([free, paid], 0);
    expect(result.map((x) => x.provider_id)).toEqual(['sd35']);
  });
});

describe('Caveat 4 — reorderForCapabilityAndCost combines both passes', () => {
  it('canonical capability order first, then cost-aware sort', () => {
    // text_to_image canonical order: flux(0), ideogram(1), recraft(2),
    // imagen(3), sd35(4). Costs: flux=6, ideogram=8, recraft=4,
    // imagen=4, sd35=0. After cost-sort with canonical tiebreaker:
    // sd35(0c)@4, recraft(4c)@2, imagen(4c)@3, flux(6c)@0,
    // ideogram(8c)@1.
    const flux = adapter('flux', ['text_to_image'], 6);
    const ideogram = adapter('ideogram', ['text_to_image'], 8);
    const recraft = adapter('recraft', ['text_to_image', 'image_to_image'], 4);
    const imagen = adapter('imagen', ['text_to_image'], 4);
    const sd35 = adapter('sd35', ['text_to_image'], 0);
    const result = reorderForCapabilityAndCost(
      'text_to_image',
      [flux, ideogram, recraft, imagen, sd35],
      100,
    );
    expect(result.map((a) => a.provider_id)).toEqual([
      'sd35', //    0c
      'recraft', // 4c (canonical position 2)
      'imagen', //  4c (canonical position 3)
      'flux', //    6c
      'ideogram', // 8c
    ]);
  });

  it('drops capability-incompatible adapters before sorting', () => {
    const flux = adapter('flux', ['text_to_image'], 6);
    const runway = adapter('runway', ['text_to_video'], 50);
    const result = reorderForCapabilityAndCost(
      'text_to_image',
      [flux, runway],
      100,
    );
    expect(result.map((a) => a.provider_id)).toEqual(['flux']);
  });

  it('drops over-budget capability-eligible adapters', () => {
    const flux = adapter('flux', ['text_to_image'], 60);
    const imagen = adapter('imagen', ['text_to_image'], 4);
    const result = reorderForCapabilityAndCost(
      'text_to_image',
      [flux, imagen],
      20, // only imagen fits
    );
    expect(result.map((a) => a.provider_id)).toEqual(['imagen']);
  });

  it('returns empty when no adapter matches the capability', () => {
    const runway = adapter('runway', ['text_to_video'], 50);
    const result = reorderForCapabilityAndCost(
      'lipsync_video',
      [runway],
      1000,
    );
    expect(result).toEqual([]);
  });
});

describe('Caveat 4 — canonical reorderForCapability is the quality preference', () => {
  it('reorderForCapability still emits canonical order on its own', () => {
    const flux = adapter('flux', ['text_to_image'], 6);
    const ideogram = adapter('ideogram', ['text_to_image'], 8);
    const result = reorderForCapability('text_to_image', [ideogram, flux]);
    // Canonical: flux before ideogram.
    expect(result.map((a) => a.provider_id)).toEqual(['flux', 'ideogram']);
  });

  it('cost-aware pass swaps canonical order when cost differs', () => {
    const flux = adapter('flux', ['text_to_image'], 6);
    const ideogram = adapter('ideogram', ['text_to_image'], 8);
    const recraft = adapter('recraft', ['text_to_image'], 4);
    const result = reorderForCapabilityAndCost(
      'text_to_image',
      [flux, ideogram, recraft],
      100,
    );
    // recraft is cheapest → wins despite being canonical position 3.
    expect(result[0]?.provider_id).toBe('recraft');
  });
});
