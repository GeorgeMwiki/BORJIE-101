/**
 * Africa's Talking IVR -> STT adapter (LP-25).
 *
 * Phone-channel voice for miners on feature phones. The miner presses a key
 * on the USSD menu, the platform calls back, and a small IVR walks them
 * through a spoken production report. Africa's Talking is the canonical
 * TZ/KE/UG/RW voice gateway (TCRA-licensed); the IVR is modelled as a pure
 * state machine that returns the XML AT expects per step.
 *
 * What is REAL here:
 *   - The IVR state machine (`stepIvr`) — fully implemented + tested,
 *     bilingual, mining-re-skinned (report output / hear royalty).
 *   - The inline STT path (`transcribeRecording`) reusing an injected STT
 *     port (the `@borjie/audio-capture` STTPort shape) + the SSRF-safe fetch
 *     port for the attacker-influenceable recording URL.
 *
 * What is SCAFFOLDED (TODO(LP-25)):
 *   - The exact AT `<Response>` verb attributes and the callback parameter
 *     names (`isActive`, `recordingUrl`, `dtmfDigits`, ...) are AT-specific;
 *     the helpers below emit the common subset and mark the gaps. Outbound
 *     call placement + AT HMAC-SHA1 signature live behind the gateway's
 *     SignatureVerifier and the host's HTTP client, not in this leaf.
 *
 * @module @borjie/channel-gateway/africas-talking-ivr
 */

import type { SafeFetchPort } from './ports.js';

// ----------------------------------------------------------------------------
// STT port (mirrors @borjie/audio-capture STTPort minimal contract)
// ----------------------------------------------------------------------------

/**
 * Minimal STT contract the IVR needs. The host wires this to the
 * `@borjie/audio-capture` STT adapter (Intron for Swahili-first, Whisper
 * local for offline tenants, etc.). We re-declare the slice we use so this
 * package does not hard-depend on audio-capture's full surface.
 */
export interface IvrSttPort {
  transcribeBytes(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    /** "auto" lets the provider detect; "sw"/"en" pin the language. */
    readonly language: 'sw' | 'en' | 'auto';
  }): Promise<{ readonly transcript: string; readonly language: string; readonly confidence?: number }>;
}

// ----------------------------------------------------------------------------
// IVR state machine
// ----------------------------------------------------------------------------

export type IvrState =
  | 'menu_root'
  | 'menu_language'
  | 'report_intro'
  | 'report_amount'
  | 'report_capture'
  | 'complete'
  | 'drop';

export type IvrLanguage = 'en' | 'sw';

export interface IvrInput {
  /** AT-provided session id, stable across the call. */
  readonly sessionId: string;
  /** Caller phone in E.164. */
  readonly callerNumber: string;
  readonly state: IvrState;
  readonly language?: IvrLanguage;
  /** DTMF digits from the prior step, if any. */
  readonly digits?: string;
}

export interface IvrStepResponse {
  readonly nextState: IvrState;
  readonly language: IvrLanguage;
  /** XML to return verbatim to the AT webhook. */
  readonly xml: string;
}

/**
 * Advance the IVR by one step. Pure — side effects (persisting the report,
 * sending an SMS receipt) live in the route handler. Mining re-skin of
 * LITFIN's loan IVR: the spoken capture is a production report, not a loan
 * purpose.
 */
export function stepIvr(input: IvrInput): IvrStepResponse {
  const lang: IvrLanguage = input.language ?? 'sw';

  switch (input.state) {
    case 'menu_root':
      return {
        nextState: 'menu_language',
        language: lang,
        xml: buildResponse(
          [sayEn('Welcome to Borjie. Press 1 for English, 2 for Swahili.')],
          { numDigits: 1 },
        ),
      };

    case 'menu_language': {
      const choice = (input.digits ?? '').trim();
      if (choice === '1') {
        return {
          nextState: 'report_intro',
          language: 'en',
          xml: buildResponse([sayEn('English selected. Press 1 to report output.')], {
            numDigits: 1,
          }),
        };
      }
      if (choice === '2') {
        return {
          nextState: 'report_intro',
          language: 'sw',
          xml: buildResponse([saySw('Umechagua Kiswahili. Bonyeza 1 kuripoti uzalishaji.')], {
            numDigits: 1,
          }),
        };
      }
      return {
        nextState: 'menu_language',
        language: lang,
        xml: buildResponse([sayEn('Invalid. Press 1 for English, 2 for Swahili.')], {
          numDigits: 1,
        }),
      };
    }

    case 'report_intro':
      if ((input.digits ?? '').trim() === '1') {
        return {
          nextState: 'report_amount',
          language: lang,
          xml: buildResponse(
            [
              lang === 'sw'
                ? saySw('Weka uzalishaji kwa gramu, kisha bonyeza nyota.')
                : sayEn('Enter output in grams, then press star.'),
            ],
            { numDigits: 9, finishOnKey: '*' },
          ),
        };
      }
      return {
        nextState: 'drop',
        language: lang,
        xml: buildResponse([lang === 'sw' ? saySw('Kwaheri.') : sayEn('Goodbye.')], {
          hangup: true,
        }),
      };

    case 'report_amount': {
      const grams = Number((input.digits ?? '').trim());
      if (!Number.isFinite(grams) || grams <= 0) {
        return {
          nextState: 'report_amount',
          language: lang,
          xml: buildResponse(
            [lang === 'sw' ? saySw('Kiasi batili. Jaribu tena.') : sayEn('Invalid amount. Try again.')],
            { numDigits: 9, finishOnKey: '*' },
          ),
        };
      }
      return {
        nextState: 'report_capture',
        language: lang,
        xml: buildResponse(
          [
            lang === 'sw'
              ? saySw('Eleza maelezo ya uzalishaji baada ya mlio. Bonyeza nyota ukimaliza.')
              : sayEn('Describe the output after the beep. Press star when done.'),
          ],
          { record: true, finishOnKey: '*' },
        ),
      };
    }

    case 'report_capture':
      return {
        nextState: 'complete',
        language: lang,
        xml: buildResponse(
          [
            lang === 'sw'
              ? saySw('Asante. Ripoti yako imepokelewa.')
              : sayEn('Thank you. Your report has been received.'),
          ],
          { hangup: true },
        ),
      };

    case 'complete':
    case 'drop':
    default:
      return {
        nextState: 'drop',
        language: lang,
        xml: buildResponse([lang === 'sw' ? saySw('Kwaheri.') : sayEn('Goodbye.')], {
          hangup: true,
        }),
      };
  }
}

// ----------------------------------------------------------------------------
// Inline STT for a finished recording
// ----------------------------------------------------------------------------

export type TranscribeRecordingResult =
  | {
      readonly ok: true;
      readonly transcript: string;
      readonly language: string;
      readonly confidence?: number;
    }
  | { readonly ok: false; readonly reason: string };

export interface TranscribeRecordingDeps {
  readonly stt: IvrSttPort;
  readonly safeFetch: SafeFetchPort;
}

/** Hard cap so a hostile/oversized recording cannot exhaust the worker. */
const RECORDING_MAX_BYTES = 10 * 1024 * 1024; // 10 MB >> a 60s IVR clip
const RECORDING_TIMEOUT_MS = 15_000;

/**
 * Fetch a finished AT recording (SSRF-safely) and transcribe it with the
 * injected STT port, returning structured text so a feature-phone miner's
 * spoken report is captured inline.
 *
 * Fail-soft by contract: every error path resolves to `{ ok: false }`. The
 * recording URL is attacker-influenceable (it arrives over the webhook), so
 * it MUST go through the injected SSRF-safe fetch port — never a bare fetch.
 */
export async function transcribeRecording(
  recordingUrl: string,
  language: 'sw' | 'en' | 'auto',
  deps: TranscribeRecordingDeps,
): Promise<TranscribeRecordingResult> {
  if (!recordingUrl) return { ok: false, reason: 'missing_recording_url' };

  let fetched;
  try {
    fetched = await deps.safeFetch.fetch(recordingUrl, {
      maxBytes: RECORDING_MAX_BYTES,
      timeoutMs: RECORDING_TIMEOUT_MS,
    });
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
  if (!fetched.ok || !fetched.bytes) {
    return { ok: false, reason: fetched.reason ?? `fetch_status:${fetched.status}` };
  }
  if (fetched.bytes.byteLength === 0) {
    return { ok: false, reason: 'empty_recording' };
  }

  try {
    const result = await deps.stt.transcribeBytes({
      bytes: fetched.bytes,
      mimeType: fetched.contentType ?? 'audio/wav',
      language,
    });
    const transcript = (result.transcript ?? '').trim();
    if (!transcript) return { ok: false, reason: 'empty_transcript' };
    return {
      ok: true,
      transcript,
      language: result.language || language,
      ...(typeof result.confidence === 'number' ? { confidence: result.confidence } : {}),
    };
  } catch {
    return { ok: false, reason: 'transcription_failed' };
  }
}

// ----------------------------------------------------------------------------
// XML helpers (AT subset; TODO(LP-25) for full verb attribute coverage)
// ----------------------------------------------------------------------------

interface ResponseOptions {
  readonly numDigits?: number;
  readonly finishOnKey?: string;
  readonly hangup?: boolean;
  readonly record?: boolean;
}

/**
 * Build an AT `<Response>` body. Emits the common subset of verbs
 * (`<Say>`, `<GetDigits>`, `<Record>`, `<Hangup>`).
 *
 * TODO(LP-25): AT supports additional verbs + attributes (`<Dial>`,
 * `<Enqueue>`, `callbackUrl`, `playBeep`, `maxLength` tuning, `<Redirect>`).
 * Wire the full attribute set + the `action` callback URL once the AT voice
 * number and webhook host are provisioned. The state machine above is the
 * stable contract; only the XML surface needs completing.
 */
function buildResponse(children: string[], opts: ResponseOptions = {}): string {
  const body: string[] = ['<?xml version="1.0"?>', '<Response>'];
  if (opts.numDigits) {
    const finish = opts.finishOnKey ? ` finishOnKey="${opts.finishOnKey}"` : '';
    body.push(`<GetDigits numDigits="${opts.numDigits}"${finish}>`);
    body.push(...children);
    body.push('</GetDigits>');
  } else if (opts.record) {
    // TODO(LP-25): add `callbackUrl` so AT posts the finished recordingUrl.
    body.push(`<Record finishOnKey="${opts.finishOnKey ?? '*'}" maxLength="60" trimSilence="true">`);
    body.push(...children);
    body.push('</Record>');
  } else {
    body.push(...children);
  }
  if (opts.hangup) body.push('<Hangup/>');
  body.push('</Response>');
  return body.join('\n');
}

function sayEn(text: string): string {
  return `<Say voice="en-US-Standard-B" playBeep="false">${escapeXml(text)}</Say>`;
}

function saySw(text: string): string {
  return `<Say voice="sw-TZ-Standard-A" playBeep="false">${escapeXml(text)}</Say>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
