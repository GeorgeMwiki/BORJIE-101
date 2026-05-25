/**
 * vLLM adapter — high-throughput self-hosted inference server.
 *
 * vLLM exposes an OpenAI-compatible REST API (`/v1/chat/completions`), so this
 * adapter delegates to `OpenAIAdapter` with a custom `baseUrl`. We keep it as
 * a distinct class so the router can identify the provider channel in
 * telemetry / fallback decisions.
 */

import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';
import { OpenAIAdapter } from './openai-adapter.js';
import type { FetchFn } from './base-adapter.js';

export interface VLLMAdapterConfig {
  readonly baseUrl: string;
  /** vLLM doesn't require an API key by default but may use a shared secret. */
  readonly apiKey?: string;
  readonly fetchFn?: FetchFn;
}

export class VLLMAdapter implements BrainLLMClient {
  public readonly provider: ProviderName = 'vllm';
  private readonly inner: OpenAIAdapter;

  constructor(config: VLLMAdapterConfig) {
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey ?? 'sk-vllm-noop',
      baseUrl: config.baseUrl,
      ...(config.fetchFn !== undefined ? { fetchFn: config.fetchFn } : {}),
    });
  }

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    const resp = await this.inner.invoke(req);
    // Stamp provider as 'vllm' (not 'openai') so observability reflects the channel.
    return { ...resp, provider: this.provider };
  }
}
