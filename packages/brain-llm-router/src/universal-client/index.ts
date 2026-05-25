/**
 * universal-client/ — LiteLLM-style universal adapter layer.
 *
 * Exports five concrete adapters and the shared base utilities. Each adapter
 * implements `BrainLLMClient` and translates `BrainLLMRequest` (Anthropic-
 * shape) to its provider's native API and back.
 */

export { AnthropicAdapter, type AnthropicAdapterConfig } from './anthropic-adapter.js';
export { OpenAIAdapter, type OpenAIAdapterConfig } from './openai-adapter.js';
export { GoogleAdapter, type GoogleAdapterConfig } from './google-adapter.js';
export { OllamaAdapter, type OllamaAdapterConfig } from './ollama-adapter.js';
export { VLLMAdapter, type VLLMAdapterConfig } from './vllm-adapter.js';
export type { FetchFn } from './base-adapter.js';
