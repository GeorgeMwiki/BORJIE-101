/**
 * `borjie chat "<prompt>"` — stream a teaching response from the brain
 * via /api/v1/brain/teach SSE.
 *
 * Honours --language sw|en and surfaces every message_chunk in order.
 * In JSON mode, every parsed event is emitted as a newline-delimited
 * JSON object so wrapper scripts can consume the stream cleanly.
 */

import { requireSession } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function chatCommand(opts: {
  readonly logger: BorjieLogger;
  readonly prompt: string;
  readonly language?: 'sw' | 'en';
  readonly sessionId?: string;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const language = opts.language ?? 'sw';
  const body = {
    prompt: opts.prompt,
    language,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  };
  let printedNewline = false;
  try {
    for await (const evt of session.http.stream('/api/v1/brain/teach', {
      method: 'POST',
      body,
    })) {
      if (opts.logger.opts.json) {
        opts.logger.raw(
          JSON.stringify({ event: evt.event, data: tryParseJson(evt.data) }),
        );
        continue;
      }
      if (evt.event === 'message_chunk') {
        const parsed = tryParseJson(evt.data) as { text?: string } | null;
        if (parsed?.text) {
          process.stdout.write(parsed.text);
          printedNewline = false;
        }
      } else if (evt.event === 'error') {
        const parsed = tryParseJson(evt.data) as { message?: string } | null;
        opts.logger.error(parsed?.message ?? evt.data);
      } else if (evt.event === 'done') {
        if (!printedNewline) {
          process.stdout.write('\n');
          printedNewline = true;
        }
      }
    }
  } finally {
    if (!opts.logger.opts.json && !printedNewline) {
      process.stdout.write('\n');
    }
  }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
