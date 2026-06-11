/**
 * Removal-proof: the pre-Borjie property-era ESTATE dispatch relic is gone.
 *
 * Context: `createStubEstateHandlerDeps` (in the api-gateway composition)
 * returned a FAKE ledger id `stub_ledger_<rand>` from a fabricated
 * `ledger.post()`, violating the CLAUDE.md hard rule "money goes ONLY
 * through LedgerService.post()". That stub — plus the whole property-era
 * ESTATE dispatch surface (the `create_lease_application` /
 * `post_receipt_draft` AcceptHandlers, their registry branch, their
 * matrix rows, and the `EstateHandlerDeps` type) — was EXCISED. A mining
 * estate uses licences + royalty/sales, whose real money already flows
 * through `LedgerService.post()` in `services/payments-ledger`; no
 * dispatch handler ever touches money.
 *
 * This test asserts, at the registry seam, that:
 *   1. the MINING actions are still registrable (the surviving handlers);
 *   2. the property-era ESTATE actions are NOT registrable — the registry
 *      returns `undefined` for them, so the brain can never dispatch a
 *      `create_lease_application` proposal that would reach the dead stub;
 *   3. `CreateModuleHandlerRegistryDeps` no longer carries an `estate`
 *      field (compile-time proof the excision is structural, not gated).
 */

import { describe, it, expect } from 'vitest';
import type { AcceptHandler } from '@borjie/dispatch-router';
import {
  createModuleHandlerRegistry,
  type CreateModuleHandlerRegistryDeps,
} from '../registry.js';

const noopHandler: AcceptHandler = async () => ({ ok: true, artifacts: [] });

describe('ESTATE dispatch relic excision', () => {
  it('still registers the surviving MINING actions', () => {
    const registry = createModuleHandlerRegistry({
      overrides: {
        'MINING::schedule_licence_renewal': noopHandler,
        'MINING::open_equipment_maintenance': noopHandler,
        'MINING::bulk_mark_licences_for_renewal': noopHandler,
      },
    });

    for (const action of [
      'schedule_licence_renewal',
      'open_equipment_maintenance',
      'bulk_mark_licences_for_renewal',
    ]) {
      expect(registry.get('MINING', action)).toBeTypeOf('function');
    }
  });

  it('does NOT register the property-era ESTATE actions', () => {
    const registry = createModuleHandlerRegistry({});
    // The brain can never dispatch these — they resolve to no handler, so
    // the dead `stub_ledger_<rand>` fake-money path is unreachable.
    expect(registry.get('ESTATE', 'create_lease_application')).toBeUndefined();
    expect(registry.get('ESTATE', 'post_receipt_draft')).toBeUndefined();
  });

  it('the registry deps surface no longer accepts an estate field', () => {
    const deps: CreateModuleHandlerRegistryDeps = {};
    // @ts-expect-error — `estate` was excised from the deps type entirely.
    deps.estate = {};
    expect(deps).toBeDefined();
  });
});
