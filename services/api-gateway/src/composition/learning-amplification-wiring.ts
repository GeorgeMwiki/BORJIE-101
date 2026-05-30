/**
 * Learning Amplification wiring — boots the Borjie continuous-learning
 * loop (packages/learning-amplification, ported from LitFin).
 *
 *   - Resolves a Supabase service-role client from
 *     NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   - Calls configureLearningAmplification + configureAmplificationJob
 *     so recordObservation()/runAmplification() can find the client.
 *   - When env is absent, both APIs degrade to no-ops (the recorder
 *     bumps an in-memory dropped counter exposed via
 *     recordedObservationsDropped()).
 *
 * Mirrors the shape of signup-wiring.ts so the gateway's degraded mode
 * stays uniform.
 */

import type { Logger as PinoLogger } from 'pino';
import { createClient } from '@supabase/supabase-js';
import {
  configureAmplificationJob,
  configureLearningAmplification,
  type SupabaseLike,
} from '@borjie/learning-amplification';

export interface LearningAmplificationWiringInput {
  readonly logger: PinoLogger;
  readonly supabaseClient?: SupabaseLike | null;
}

export interface LearningAmplificationWiringResult {
  readonly enabled: boolean;
  readonly degradedReason?: 'missing_env' | 'init_failed';
}

export function createLearningAmplificationWiring(
  input: LearningAmplificationWiringInput,
): LearningAmplificationWiringResult {
  const override = input.supabaseClient;
  if (override) {
    const factory = (): SupabaseLike => override;
    configureLearningAmplification(factory);
    configureAmplificationJob(factory);
    return { enabled: true };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    input.logger.warn(
      {
        wiring: 'learning-amplification',
        supabaseUrl: Boolean(url),
        supabaseServiceRoleKey: Boolean(key),
      },
      'learning-amplification: Supabase env unset — recordObservation will drop silently',
    );
    return { enabled: false, degradedReason: 'missing_env' };
  }

  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const factory = (): SupabaseLike => client as unknown as SupabaseLike;
    configureLearningAmplification(factory);
    configureAmplificationJob(factory);
    input.logger.info(
      { wiring: 'learning-amplification' },
      'learning-amplification: configured against Supabase service-role client',
    );
    return { enabled: true };
  } catch (err) {
    input.logger.warn(
      {
        wiring: 'learning-amplification',
        err: err instanceof Error ? err.message : String(err),
      },
      'learning-amplification: Supabase client init failed — degrading to no-op',
    );
    return { enabled: false, degradedReason: 'init_failed' };
  }
}
