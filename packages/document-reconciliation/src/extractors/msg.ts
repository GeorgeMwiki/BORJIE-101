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
 * Extract an Outlook `.msg`.
 *
 * `MsgReaderPort` is the injected extension seam: a host that needs native
 * `.msg` support binds it to an MS-OXMSG reader (for example
 * `@kenjiuno/msgreader`) and the parsed fields flow straight through. When no
 * reader is wired this throws `MsgUnsupportedError` with the deterministic
 * `MSG_UNSUPPORTED` code, which is the documented signal for callers to route
 * the document to the `.eml` / `.pdf` fallback. Keeping the binary parse
 * behind the port is deliberate — it keeps this leaf free of a heavy
 * compound-file dependency.
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
