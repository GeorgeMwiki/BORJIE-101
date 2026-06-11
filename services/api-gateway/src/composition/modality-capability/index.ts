/**
 * Modality-capability composition root.
 *
 * Constructs the three engines (forecast / media / document) ONCE at boot,
 * wraps them as rail-gated, evidence-stamped capability brain-tools, and
 * assembles the modality executor that the arbiter routes artifact modalities
 * to. Keys, budgets, and fetch are injected here (bootstrap seam) — no engine
 * reads env of its own.
 *
 * Behind `BORJIE_MODALITY_CAPABILITIES` (DEFAULT-ON kill-switch — only an
 * explicit off/0/false/no reverts to today's behaviour: the existing image/
 * chart/diagram/infographic tools stay; no forecast/video/gif/document
 * capability tools and no arbiter→engine routing). When ON (the default), the
 * capability tools are returned for the composition root to register alongside
 * the existing media tools, and the executor is returned for the arbiter
 * binding. The proposal channel is the EXISTING portal-genui `tab_proposal`
 * path — no UI mutates without owner approval.
 *
 * @module composition/modality-capability
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import { createForecastEngine, type ForecastEngine } from '@borjie/forecast-engine';
import { createMediaEngine, type MediaEngine, type FetchLike } from '@borjie/media-engine';
import {
  createDocumentStudioWithCoreTypes,
  type DocumentStudio,
} from '@borjie/document-studio';

import { buildForecastCapabilityTool } from './forecast-tool.js';
import { buildMediaCapabilityTools } from './media-tools.js';
import { buildDocumentCapabilityTool } from './document-tool.js';
import { createMediaContextProvider, type MediaContextProvider } from './media-context.js';
import {
  createModalityExecutor,
  type ModalityExecutor,
  type ModalityProposalSink,
} from './modality-executor.js';

export type {
  ModalityExecutor,
  ModalityProposalSink,
  ModalityExecutionResult,
} from './modality-executor.js';
export type {
  ModalityProposal,
  ModalityArtifactKind,
  ReasonedNeed,
} from './modality-proposal.js';
export { buildModalityProposal } from './modality-proposal.js';
export { refineModalityProposal } from './modality-refine.js';

/**
 * Resolve the capability flag — DEFAULT-ON kill-switch (Wave-B activation,
 * mirrors `resolveModalityArbiterEnabled` in brain-kernel-wiring.ts). Only an
 * explicit `off`/`0`/`false`/`no` disables it; an unset / typo'd value ARMS
 * the three generative engines (forecast / media / document) so the executor
 * singleton constructs and the capability brain-tools register by default.
 *
 * This is safe because the engines default to zero-keys mode (classical-floor
 * forecasts, stub media bytes, stub document renderers) so the gateway boots
 * without provider keys; the FORCED gates (locale-purity, citation-coverage,
 * WORM seal) and the proposal-only UI invariant (portal-genui `tab_proposal`)
 * run regardless. No surface mutates without owner approval.
 */
export function resolveModalityCapabilitiesEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = (env['BORJIE_MODALITY_CAPABILITIES'] ?? 'on').trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(raw);
}

export interface ModalityCapabilitiesDeps {
  readonly envSource: Readonly<Record<string, string | undefined>>;
  readonly proposalSink: ModalityProposalSink;
  readonly fetch?: FetchLike;
  readonly logger?: {
    info?(meta: object, msg: string): void;
    warn?(meta: object, msg: string): void;
  };
  /** Bucket sealed documents archive under. */
  readonly documentBucket?: string;
}

export interface ModalityCapabilities {
  /** True when the capability flag is on (engines + tools constructed). */
  readonly enabled: boolean;
  /** The capability brain-tools to register alongside existing media tools. */
  readonly capabilityTools: ReadonlyArray<ToolHandler>;
  /** The arbiter → engine → proposal executor (null when disabled). */
  readonly executor: ModalityExecutor | null;
  /** The constructed engines (for the artifact route + tests). */
  readonly forecastEngine: ForecastEngine | null;
  readonly mediaEngine: MediaEngine | null;
  readonly mediaContextProvider: MediaContextProvider | null;
  readonly documentStudio: DocumentStudio | null;
}

/**
 * Build the modality capabilities. When the flag is OFF this returns an empty,
 * inert bundle — the composition root registers no capability tools and binds
 * no executor, so the brain behaves exactly as today.
 */
export function buildModalityCapabilities(
  deps: ModalityCapabilitiesDeps,
): ModalityCapabilities {
  const enabled = resolveModalityCapabilitiesEnabled(deps.envSource);
  if (!enabled) {
    return {
      enabled: false,
      capabilityTools: [],
      executor: null,
      forecastEngine: null,
      mediaEngine: null,
      mediaContextProvider: null,
      documentStudio: null,
    };
  }

  // Engines — constructed once. Each defaults to a zero-keys-safe mode
  // (classical-floor forecasts, stub media bytes, stub document renderers)
  // so the gateway boots without provider keys; real adapters slot in when
  // keys are present in the env source.
  const forecastEngine = createForecastEngine();
  const mediaEngine: MediaEngine = createMediaEngine();
  const mediaContextProvider = createMediaContextProvider({
    envSource: deps.envSource,
    ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  // Stub renderers/archive by default — real Carbone/Typst/Puppeteer backends
  // bind via the studio's injected ports in a follow-up; the FORCED gates
  // (locale-purity, citation-coverage, WORM seal) run regardless.
  const documentStudio: DocumentStudio = createDocumentStudioWithCoreTypes({ useStub: true });

  const capabilityTools: ToolHandler[] = [
    buildForecastCapabilityTool({ engine: forecastEngine }),
    ...buildMediaCapabilityTools({ engine: mediaEngine, contextProvider: mediaContextProvider }),
    buildDocumentCapabilityTool({
      studio: documentStudio,
      ...(deps.documentBucket ? { bucket: deps.documentBucket } : {}),
    }),
  ];

  const executor = createModalityExecutor({
    forecastEngine,
    mediaEngine,
    mediaContextProvider,
    documentStudio,
    proposalSink: deps.proposalSink,
    ...(deps.logger
      ? {
          logger: {
            warn: (meta: object, msg: string): void => deps.logger?.warn?.(meta, msg),
            ...(deps.logger.info
              ? { info: (meta: object, msg: string): void => deps.logger?.info?.(meta, msg) }
              : {}),
          },
        }
      : {}),
  });

  deps.logger?.info?.(
    {
      wiring: 'modality-capabilities',
      tools: capabilityTools.map((t) => t.name),
      mediaProviders: mediaContextProvider.configuredProviderIds,
    },
    'modality-capabilities: forecast/media/document engines + capability tools + executor constructed',
  );

  return {
    enabled: true,
    capabilityTools,
    executor,
    forecastEngine,
    mediaEngine,
    mediaContextProvider,
    documentStudio,
  };
}

/**
 * Rebind a constructed capabilities bundle's ENGINES to a per-request
 * proposal sink. The engines are constructed once at boot; the sink is
 * per-request (it carries the live tenant/user/locale scope). This keeps a
 * single execution path of record while letting each turn surface its
 * proposal into the correct tenant inbox + tray.
 *
 * Returns `null` when the capabilities are disabled / not constructed.
 */
export function createModalityExecutorBoundToSink(
  caps: ModalityCapabilities | null,
  sink: ModalityProposalSink,
  logger?: { warn(meta: object, msg: string): void; info?(meta: object, msg: string): void },
): ModalityExecutor {
  return createModalityExecutor({
    ...(caps?.forecastEngine ? { forecastEngine: caps.forecastEngine } : {}),
    ...(caps?.mediaEngine ? { mediaEngine: caps.mediaEngine } : {}),
    ...(caps?.mediaContextProvider ? { mediaContextProvider: caps.mediaContextProvider } : {}),
    ...(caps?.documentStudio ? { documentStudio: caps.documentStudio } : {}),
    proposalSink: sink,
    ...(logger ? { logger } : {}),
  });
}
