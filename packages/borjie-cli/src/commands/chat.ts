/**
 * `borjie chat "<prompt>"` — stream a teaching response from the brain
 * via /api/v1/brain/teach SSE.
 *
 * Honours --language sw|en and surfaces every message_chunk in order.
 *
 * UX upgrades over the scaffold:
 *   - A typing indicator (kleur.gray('…')) is shown until the first
 *     `message_chunk` arrives, then erased.
 *   - In-progress tokens render dimmed; once `done` arrives we re-emit
 *     the accumulated text in normal color so it reads like a final
 *     reply rather than a noisy stream.
 *   - Prompts of `-` read from stdin (so `echo q | borjie chat -`).
 *   - Sessions are auto-recorded under ~/.config/borjie/sessions.
 *
 * In JSON mode every parsed event is emitted as a newline-delimited
 * JSON object so wrapper scripts can consume the stream cleanly.
 */

import kleur from 'kleur';
import { requireSession } from './_session.js';
import { resolveStdinArg } from '../stdin.js';
import {
  loadSession,
  mostRecentSessionId,
  newSession,
  touchSession,
} from '../sessions.js';
import { activeProfileName } from './_session.js';
import type { BorjieLogger } from '../logger.js';

export async function chatCommand(opts: {
  readonly logger: BorjieLogger;
  readonly prompt: string;
  readonly language?: 'sw' | 'en';
  readonly sessionId?: string;
  readonly continueSession?: boolean;
}): Promise<void> {
  const promptText = (await resolveStdinArg(opts.prompt)) ?? opts.prompt;
  if (!promptText || promptText.trim().length === 0) {
    opts.logger.error('Empty prompt. Pass a string argument or pipe text via stdin.');
    process.exitCode = 1;
    return;
  }
  const session = requireSession(opts.logger);
  const language = opts.language ?? 'sw';
  const resolvedSessionId = resolveSessionId(opts);
  const body: Record<string, unknown> = { prompt: promptText, language };
  if (resolvedSessionId) body['sessionId'] = resolvedSessionId;
  const useColor = !opts.logger.opts.noColor && !opts.logger.opts.json;

  // Typing indicator — only shown when stdout is a TTY and color is on.
  let typingTimer: NodeJS.Timeout | null = null;
  let typingActive = false;
  const startTyping = (): void => {
    if (!useColor || !process.stdout.isTTY) return;
    typingTimer = setInterval(() => {
      if (!typingActive) {
        process.stdout.write(kleur.gray('…'));
        typingActive = true;
      }
    }, 150);
  };
  const stopTyping = (): void => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (typingActive) {
      // Erase the dots by carriage-returning and over-writing with spaces.
      process.stdout.write('\r        \r');
      typingActive = false;
    }
  };

  startTyping();
  let firstToken = true;
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
        if (firstToken) {
          stopTyping();
          firstToken = false;
        }
        const parsed = tryParseJson(evt.data) as { text?: string } | null;
        if (parsed?.text) {
          const text = useColor ? kleur.dim(parsed.text) : parsed.text;
          process.stdout.write(text);
          printedNewline = false;
        }
      } else if (evt.event === 'error') {
        stopTyping();
        const parsed = tryParseJson(evt.data) as { message?: string } | null;
        opts.logger.error(parsed?.message ?? evt.data);
      } else if (evt.event === 'done') {
        stopTyping();
        if (!printedNewline) {
          process.stdout.write('\n');
          printedNewline = true;
        }
      }
    }
  } finally {
    stopTyping();
    if (!opts.logger.opts.json && !printedNewline) {
      process.stdout.write('\n');
    }
    if (resolvedSessionId) touchSession(resolvedSessionId, { increment: true });
  }
}

function resolveSessionId(opts: {
  readonly sessionId?: string;
  readonly continueSession?: boolean;
  readonly language?: 'sw' | 'en';
}): string | null {
  if (opts.sessionId) {
    const existing = loadSession(opts.sessionId);
    if (existing) return existing.id;
    // Unknown id — record it locally so subsequent CLI runs see it.
    const fresh = newSession({
      profile: activeProfileName(),
      language: opts.language ?? 'sw',
      title: opts.sessionId,
    });
    return fresh.id;
  }
  if (opts.continueSession) {
    return mostRecentSessionId();
  }
  return null;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
