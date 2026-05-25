/**
 * Module-template bundle types — the shape registered by each of the
 * 10 platform templates.
 *
 * A bundle is:
 *   - `slug`            — UPPERCASE template slug ('ESTATE', 'HR', ...)
 *   - `titleEn`/`titleSw`/`description` — display metadata
 *   - `spec`            — the validated ModuleSpec (default_spec_jsonb)
 *   - `acceptHandlers[]`— accept_proposal handler descriptors
 *
 * Bundles ship as code+JSON so the orchestrator can install them on
 * startup. The brain references them by slug.
 */

import type { ModuleSpec } from '@borjie/module-spec-engine';

export interface ModuleTemplateBundle {
  readonly slug: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly description: string;
  readonly icon: string;
  readonly spec: ModuleSpec;
  readonly acceptHandlers: ReadonlyArray<AcceptHandlerDescriptor>;
}

export interface AcceptHandlerDescriptor {
  readonly action: string;
  readonly handlerModule: string;
  readonly allowedPersonaTiers: readonly number[];
  readonly riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'SOVEREIGN';
  readonly emitsMoneyMutation: boolean;
  /**
   * Serialised Zod tree the executor reconstructs to validate the
   * proposal payload at runtime. Matches the shape of
   * module_accept_handlers.payload_zod_jsonb.
   */
  readonly payloadZod: Readonly<Record<string, unknown>>;
}
