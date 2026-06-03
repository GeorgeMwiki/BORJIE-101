/**
 * MSG extractor (LP-26).
 *
 * Outlook `.msg` is a compound-file binary (MS-OXMSG). Parsing it natively is
 * out of scope for a pure leaf package, so this routes through an injected
 * `MsgReaderPort` when the host provides one (e.g. backed by
 * `@kenjiuno/msgreader`). Without it, we throw a deterministic
 * `MsgUnsupportedError` so the caller can fall back to .eml / .pdf export.
 *
 * The wire-in (stable adapter contract) is what matters; the parser binding
 * is the host's choice.
 *
 * @module @borjie/document-reconciliation/extractors/msg
 */

export interface MsgExtractionResult {
  readonly subject: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly bodyText: string;
  readonly attachments: readonly {
    readonly filename: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }[];
}

/**
 * Injected parser port. The host binds this to a real MS-OXMSG reader.
 * Keeping it a port means this package has no heavy binary-parser dependency.
 */
export interface MsgReaderPort {
  read(buffer: Uint8Array): Promise<{
    readonly subject?: string;
    readonly senderName?: string;
    readonly senderEmail?: string;
    readonly bodyText?: string;
    readonly attachments?: readonly {
      readonly filename?: string;
      readonly mimeType?: string;
      readonly bytes?: Uint8Array;
    }[];
  }>;
}

export class MsgUnsupportedError extends Error {
  readonly code = 'MSG_UNSUPPORTED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MsgUnsupportedError';
  }
}

/**
 * Extract an Outlook `.msg`. When no reader port is wired, throws
 * `MsgUnsupportedError` with a deterministic code.
 *
 * TODO(LP-26): the production host should bind `MsgReaderPort` to a
 * MS-OXMSG reader once the dependency is approved; until then callers route
 * to the .eml / .pdf fallback on `MSG_UNSUPPORTED`.
 */
export async function extractMsg(
  buffer: Uint8Array,
  reader?: MsgReaderPort,
): Promise<MsgExtractionResult> {
  if (!reader) {
    throw new MsgUnsupportedError(
      'MSG parser not wired. Inject a MsgReaderPort or export the email to .eml / .pdf.',
    );
  }
  const data = await reader.read(buffer);
  return {
    subject: data.subject ?? '',
    senderName: data.senderName ?? '',
    senderEmail: data.senderEmail ?? '',
    bodyText: data.bodyText ?? '',
    attachments: (data.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      mimeType: a.mimeType ?? 'application/octet-stream',
      bytes: a.bytes ?? new Uint8Array(),
    })),
  };
}
