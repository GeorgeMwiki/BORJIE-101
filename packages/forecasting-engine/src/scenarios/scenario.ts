/**
 * Scenario — generic API. Each library entry exports an object
 * matching `Scenario<InputT>`. The runtime validates inputs with
 * its zod schema before invoking `run`.
 */

import type { z, ZodTypeAny } from 'zod';
import type {
  BusinessContext,
  ScenarioOutcome,
  Sandbox,
} from '../types.js';

export interface ScenarioRunContext {
  readonly business: BusinessContext;
  readonly sandbox: Sandbox;
  readonly seed: number;
}

export interface Scenario<S extends ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly inputs: S;
  run(input: z.infer<S>, ctx: ScenarioRunContext): Promise<ScenarioOutcome>;
}

export interface AnyScenario {
  readonly name: string;
  readonly description: string;
  readonly inputs: ZodTypeAny;
  run(input: unknown, ctx: ScenarioRunContext): Promise<ScenarioOutcome>;
}

export function asAnyScenario<S extends ZodTypeAny>(s: Scenario<S>): AnyScenario {
  return s as unknown as AnyScenario;
}
