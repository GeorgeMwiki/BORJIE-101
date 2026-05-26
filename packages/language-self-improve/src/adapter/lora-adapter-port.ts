/**
 * LoRA adapter port — the external fine-tune provider integration point.
 *
 * Borjie does NOT own a training cluster. This port abstracts the
 * contracted provider (Anthropic / OpenAI / Together) so the runner
 * never directly knows which vendor is wired. The port surface is the
 * minimum needed for the self-improvement loop:
 *
 *   - `submitTrainingJob(pairs, baseModel)` — push curated pairs to
 *     the provider and receive a job handle.
 *   - `pollJobStatus(handle)` — pump for completion.
 *   - `materialiseAdapter(handle)` — receive a usable adapter
 *     identifier the brain-llm-router can call.
 *
 * The port is invoked only by the runner; tests inject an in-memory
 * deterministic implementation. Production wires through to
 * `@borjie/brain-llm-router`'s provider catalogue.
 */

import type {
  Adapter,
  AdapterKind,
  LanguageTag,
  TrainingPair,
} from '../types.js';

export interface TrainingJobHandle {
  readonly providerId: string;
  readonly tenantId: string;
  readonly lang: LanguageTag;
  readonly submittedAt: string;
}

export type TrainingJobStatus =
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface TrainingJobReport {
  readonly handle: TrainingJobHandle;
  readonly status: TrainingJobStatus;
  readonly adapterIdentifier: string | null;
  readonly error: string | null;
}

export interface LoraAdapterPort {
  submitTrainingJob(
    pairs: ReadonlyArray<TrainingPair>,
    baseModel: string,
    lang: LanguageTag,
    tenantId: string,
  ): Promise<TrainingJobHandle>;

  pollJobStatus(handle: TrainingJobHandle): Promise<TrainingJobReport>;

  materialiseAdapter(
    handle: TrainingJobHandle,
    version: string,
  ): Promise<Adapter>;
}

export interface InMemoryLoraConfig {
  readonly tenantId: string;
  readonly baseModel: string;
  /** Default kind for the adapters this port returns. */
  readonly defaultKind?: AdapterKind;
  /** If set, materialiseAdapter will produce a fixed identifier
   *  (deterministic tests). Otherwise a counter is used. */
  readonly fixedIdentifier?: string;
}

/**
 * In-memory deterministic implementation of `LoraAdapterPort` — used by
 * tests and by the local-dev composition root. Records every submission
 * + poll + materialise call on `history` so tests can assert ordering.
 */
export function createInMemoryLoraPort(
  config: InMemoryLoraConfig,
): LoraAdapterPort & {
  readonly history: ReadonlyArray<string>;
} {
  let counter = 0;
  const history: string[] = [];

  const port: LoraAdapterPort = {
    async submitTrainingJob(
      pairs: ReadonlyArray<TrainingPair>,
      baseModel: string,
      lang: LanguageTag,
      tenantId: string,
    ): Promise<TrainingJobHandle> {
      counter++;
      const providerId = `inmem-job-${counter}-${pairs.length}-pairs`;
      history.push(`submit:${providerId}:${baseModel}:${lang}:${tenantId}`);
      return Object.freeze({
        providerId,
        tenantId,
        lang,
        submittedAt: new Date().toISOString(),
      });
    },

    async pollJobStatus(
      handle: TrainingJobHandle,
    ): Promise<TrainingJobReport> {
      history.push(`poll:${handle.providerId}`);
      return Object.freeze({
        handle,
        status: 'succeeded' as const,
        adapterIdentifier: `adapter-${handle.providerId}`,
        error: null,
      });
    },

    async materialiseAdapter(
      handle: TrainingJobHandle,
      version: string,
    ): Promise<Adapter> {
      history.push(`materialise:${handle.providerId}:${version}`);
      const identifier =
        config.fixedIdentifier ?? `adapter-${handle.providerId}`;
      return Object.freeze({
        id: identifier,
        tenantId: handle.tenantId,
        lang: handle.lang,
        version,
        adapterKind: config.defaultKind ?? 'lora',
        baseModel: config.baseModel,
        trainingPairCount: 0,
        status: 'staged' as const,
        createdAt: new Date().toISOString(),
        auditHash: identifier,
      });
    },
  };

  return Object.freeze({
    ...port,
    get history(): ReadonlyArray<string> {
      return Object.freeze([...history]);
    },
  });
}
