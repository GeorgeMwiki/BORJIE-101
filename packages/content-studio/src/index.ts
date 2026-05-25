/**
 * @borjie/content-studio — public surface.
 *
 * Multi-modal generative content for property management:
 *   - image  (Flux, Nano Banana, Ideogram, Recraft, SDXL self-host)
 *   - video  (Veo 3.1, Runway Gen-4 Turbo)
 *   - voice  (ElevenLabs v3, Cartesia Sonic-2, Spitch, Lelapa Vulavula)
 *
 * Provider stubs return deterministic placeholder URLs so the package
 * compiles and tests pass WITHOUT paid API keys. Real wiring is the
 * follow-up once keys land per provider catalogue below.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md
 */

export * from './types.js';

export { createContentRouter } from './router.js';
export type {
  ContentRouter,
  ContentRouterDeps,
  RouteDecision,
} from './router.js';

export { createFluxProvider } from './providers/image/flux.js';
export { createNanoBananaProvider } from './providers/image/nano-banana.js';
export { createIdeogramProvider } from './providers/image/ideogram.js';
export { createRecraftProvider } from './providers/image/recraft.js';
export { createSdxlSelfHostProvider } from './providers/image/sdxl-self-host.js';
export {
  createOpenAiImageProvider,
  type OpenAiImageProviderOptions,
} from './providers/image/openai-image.js';
export {
  createMeshyProvider,
  type MeshyProviderOptions,
} from './providers/image/meshy.js';

export { createVeoProvider } from './providers/video/veo.js';
export { createRunwayProvider } from './providers/video/runway.js';

export { createElevenLabsProvider } from './providers/voice/elevenlabs.js';
export { createCartesiaProvider } from './providers/voice/cartesia.js';
export { createSpitchProvider } from './providers/voice/spitch.js';
export { createLelapaProvider } from './providers/voice/lelapa.js';

export { createBrandProfile } from './brand/brand-profile.js';
export type { BrandProfileInput } from './brand/brand-profile.js';
export {
  createInMemoryLoraRegistry,
  type LoraRecord,
  type LoraRegistry,
} from './brand/lora-registry.js';

export { buildC2paManifest } from './c2pa/attestation.js';
export type { BuildManifestArgs } from './c2pa/attestation.js';

export { generateListingKit } from './workflows/listing-kit.js';
export type { ListingKit, ListingKitInput } from './workflows/listing-kit.js';

export { generateOwnerReportVideo } from './workflows/owner-monthly-report-video.js';
export type {
  OwnerReportVideo,
  OwnerReportVideoInput,
} from './workflows/owner-monthly-report-video.js';
