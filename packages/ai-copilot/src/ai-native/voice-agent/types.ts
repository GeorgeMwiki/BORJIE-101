/**
 * Voice-first tenant/owner agent types.
 *
 * The existing VoiceRouter handles STT + TTS. This layer adds the
 * conversational agent loop:
 *   - receives STT transcript,
 *   - detects language (any language — LLM),
 *   - resolves tenant context from phone/user,
 *   - dispatches to the brain with voice-tone overrides,
 *   - executes tool calls (balance check, maintenance request, schedule),
 *   - synthesizes response in the detected language.
 */

export interface VoiceTurnInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly audioUrl?: string;
  /** Inline transcript if the caller already did STT. */
  readonly transcript?: string;
  /** Optional hint; when omitted, the agent detects language via LLM. */
  readonly detectedLanguage?: string;
  readonly callerPhone?: string;
  readonly correlationId?: string;
}

export interface VoiceToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export interface VoiceTurnResult {
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly detectedLanguage: string;
  readonly inputTranscript: string;
  readonly responseText: string;
  readonly responseAudioRef: string | null;
  readonly toolCalls: readonly VoiceToolCall[];
  readonly degradedMode: boolean;
  readonly modelVersion: string | null;
  readonly promptHash: string | null;
  readonly latencyMs: number | null;
  readonly customerId: string | null;
}

export interface VoiceTurnRow extends VoiceTurnResult {
  readonly id: string;
  readonly tenantId: string;
  readonly createdAt: string;
}

export interface VoiceSttPort {
  /**
   * Returns `null` when STT is not configured — the agent handles this
   * by returning VOICE_NOT_CONFIGURED.
   */
  transcribe(input: {
    readonly audioUrl: string;
    readonly languageHint?: string;
  }): Promise<{
    readonly transcript: string;
    readonly detectedLanguage: string;
    readonly confidence: number | null;
  } | null>;
}

export interface VoiceTtsPort {
  /**
   * Returns `null` when TTS is not configured — the agent returns the text
   * response but no audio reference.
   */
  synthesize(input: {
    readonly text: string;
    readonly languageCode: string;
    readonly voiceTone?: 'warm' | 'clear' | 'patient';
  }): Promise<{ readonly audioRef: string } | null>;
}

export interface CustomerResolverPort {
  /**
   * Resolve a customer id for this tenant + caller info. Returns null when
   * no match — the agent still responds, just without personalized context.
   */
  resolve(input: {
    readonly tenantId: string;
    readonly phone?: string;
  }): Promise<{ readonly customerId: string } | null>;
}

export interface VoiceBrainResponse {
  readonly text: string;
  readonly toolCalls: readonly VoiceToolCall[];
  readonly modelVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
}

export interface VoiceBrainPort {
  /**
   * Run one brain turn given the conversation context. Tool calls are
   * already executed inside the port — it returns both the text reply
   * and the tool-call log.
   */
  turn(input: {
    readonly tenantId: string;
    readonly customerId: string | null;
    readonly sessionId: string;
    readonly userTranscript: string;
    readonly languageCode: string;
    readonly voiceTone: 'warm' | 'clear' | 'patient';
    readonly promptHash: string;
  }): Promise<VoiceBrainResponse>;
}

export interface VoiceTurnRepository {
  insert(row: VoiceTurnRow): Promise<VoiceTurnRow>;
  /** Used to compute the next `turn_index` for a session. */
  countBySession(tenantId: string, sessionId: string): Promise<number>;
  list(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly VoiceTurnRow[]>;
}
