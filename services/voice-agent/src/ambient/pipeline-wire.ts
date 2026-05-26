/**
 * Pipeline wiring — bolts the pure `@borjie/ambient-listener` package
 * into the voice-agent service. The wire is intentionally thin: it
 * assembles the in-memory reference impls plus the (host-supplied)
 * VAD / diariser / STT / redactor ports into a `ListenerPipeline` that
 * the route handlers can call.
 *
 * The pipeline is built lazily per tenant via `buildPipelineForTenant`;
 * the singleton state (the consent manager, kill switch and capture
 * repos) is held in the `AmbientWiring` returned by the factory so the
 * routes share it.
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decisions 3 + 4. The wire stamps `provenance.consent_state` verbatim
 * via the optional `cogMemoryWriter` port.
 */

import {
  createConsentManager,
  createKillSwitch,
  createInMemoryAmbientCapturesRepository,
  createInMemoryAmbientConsentsRepository,
  createInMemoryAuditChain,
  createInMemoryKillSwitchEventsRepository,
  createListenerPipeline,
  createNoopVad,
  createPiiRedactor,
  createReferenceEntityExtractor,
  createReferenceIntentExtractor,
  createReferenceSentimentExtractor,
  createSingleSpeakerDiarise,
  createFixedTranscriptStt,
  stubHasher,
  type AmbientCapturesRepository,
  type AmbientConsentsRepository,
  type CognitiveMemoryWriterPort,
  type ConsentManager,
  type DiarisePort,
  type Hasher,
  type IntentExtractorPort,
  type EntityExtractorPort,
  type SentimentExtractorPort,
  type KillSwitch,
  type KillSwitchEventsRepository,
  type ListenerPipeline,
  type ListenerPipelineDeps,
  type MetricsPort,
  type PiiRedactorPort,
  type PipelineInput,
  type PipelineOutcome,
  type SttPort,
  type VadPort,
} from '@borjie/ambient-listener';

export interface AmbientWiringOptions {
  readonly clock?: () => Date;
  /** Production hosts inject a `crypto.subtle`-backed sha256 hasher. */
  readonly hasher?: Hasher;
  /** Production hosts inject Silero VAD; the default is a permissive noop. */
  readonly vad?: VadPort;
  readonly diarise?: DiarisePort;
  /** Production stt defaults to a stub returning empty string (silent). */
  readonly stt?: SttPort;
  readonly intentExtractor?: IntentExtractorPort;
  readonly entityExtractor?: EntityExtractorPort;
  readonly sentimentExtractor?: SentimentExtractorPort;
  /** Optional — when present, every capture is observed into cognitive-memory. */
  readonly cogMemoryWriter?: CognitiveMemoryWriterPort;
  /** Optional — when present, gates the wire on a real consent + kill repo. */
  readonly consentsRepo?: AmbientConsentsRepository;
  readonly capturesRepo?: AmbientCapturesRepository;
  readonly killSwitchRepo?: KillSwitchEventsRepository;
  /** Optional — when present, increments service-level counters. */
  readonly metrics?: MetricsPort;
  readonly idGen?: () => string;
}

export interface AmbientWiring {
  readonly pipeline: ListenerPipeline;
  readonly consentManager: ConsentManager;
  readonly killSwitch: KillSwitch;
  readonly capturesRepo: AmbientCapturesRepository;
  readonly consentsRepo: AmbientConsentsRepository;
  readonly killSwitchRepo: KillSwitchEventsRepository;
  /**
   * Convenience — gate-aware capture. Routes call this directly; the
   * pipeline already silent-disables on any consent gap. The host
   * never needs to read the consent table separately.
   */
  capture(input: PipelineInput): Promise<PipelineOutcome>;
}

/**
 * Build the ambient wiring once at service start; reuse for the
 * lifetime of the process. All repos default to in-memory; production
 * deployments inject SQL-backed repos.
 */
export function createAmbientWiring(
  options: AmbientWiringOptions = {},
): AmbientWiring {
  const audit = createInMemoryAuditChain({ seed: 'voice-agent-ambient' });
  const consentsRepo =
    options.consentsRepo ?? createInMemoryAmbientConsentsRepository();
  const capturesRepo =
    options.capturesRepo ?? createInMemoryAmbientCapturesRepository();
  const killSwitchRepo =
    options.killSwitchRepo ?? createInMemoryKillSwitchEventsRepository();

  const consentManager = createConsentManager({
    repo: consentsRepo,
    audit,
    ...(options.clock ? { clock: options.clock } : {}),
  });

  const killSwitch = createKillSwitch({
    repo: killSwitchRepo,
    audit,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.idGen ? { idGen: options.idGen } : {}),
  });

  const pipelineDeps: ListenerPipelineDeps = {
    consentManager,
    killSwitch,
    vad: options.vad ?? createNoopVad(),
    diarise: options.diarise ?? createSingleSpeakerDiarise(),
    stt: options.stt ?? createFixedTranscriptStt(''),
    redactor: defaultRedactor(options.hasher),
    intentExtractor:
      options.intentExtractor ?? createReferenceIntentExtractor(),
    entityExtractor:
      options.entityExtractor ?? createReferenceEntityExtractor(),
    sentimentExtractor:
      options.sentimentExtractor ?? createReferenceSentimentExtractor(),
    capturesRepo,
    audit,
    ...(options.cogMemoryWriter
      ? { cogMemoryWriter: options.cogMemoryWriter }
      : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
    ...(options.idGen ? { idGen: options.idGen } : {}),
  };

  const pipeline = createListenerPipeline(pipelineDeps);

  return {
    pipeline,
    consentManager,
    killSwitch,
    capturesRepo,
    consentsRepo,
    killSwitchRepo,
    async capture(input: PipelineInput): Promise<PipelineOutcome> {
      return pipeline.capture(input);
    },
  };
}

/**
 * Default redactor — uses the injected hasher, falling back to the
 * deterministic stub so unit tests stay hermetic. Production hosts MUST
 * inject a `crypto.subtle`-backed hasher.
 */
function defaultRedactor(hasher: Hasher | undefined): PiiRedactorPort {
  return createPiiRedactor({ hasher: hasher ?? stubHasher });
}
