/**
 * egress-coverage — static CI tripwire for the IP-egress firewall (SEC-4).
 *
 * The egress firewall (`composition/egress-filter-wiring.ts`) is only as strong
 * as the set of routes that actually CALL it. The runtime tests
 * (egress-filter-wiring.test.ts + brain-egress-filter.test.ts) prove the strip
 * WORKS; this test proves no model-text-emitting route SKIPS it — the pragmatic
 * answer to "a brand-new route could emit raw model text unguarded and nobody
 * would notice until it leaks in production".
 *
 * Two layers:
 *
 *   (a) KNOWN-LIST assertion — every route we already know emits model text
 *       (brain.hono, brain-teach.hono, mining/chat.hono, brain-voice.hono,
 *       brain-dispatch.hono, public-chat.hono) MUST reference the egress guard.
 *       If a refactor silently drops the guard import from one of them, this
 *       fails loudly.
 *
 *   (b) HEURISTIC scan — walk EVERY `.hono.ts` route file and FAIL listing
 *       any file that BOTH (i) emits `message_chunk` SSE frames AND (ii) calls
 *       an LLM / orchestrator, yet does NOT reference the egress guard. A newly
 *       added unguarded streaming-chat surface therefore breaks CI on first
 *       commit, before it can ship a leak.
 *
 * The heuristic is deliberately CONSERVATIVE: it requires BOTH the
 * `message_chunk` streaming signal AND the LLM/orchestrator signal before it
 * flags a file. Many routes call an LLM for a NON-streaming, structured result
 * (document intelligence, reports, calendar, RFB drafting) — those do not pour
 * raw model PROSE onto an SSE stream the way a chat surface does, and the brain
 * routes that DO emit model text on a non-`message_chunk` frame (voice
 * transcript, sub-MD dispatch) are caught by the KNOWN-LIST instead. Requiring
 * both signals keeps the false-positive rate at zero for non-chat routes while
 * still catching the real leak vector (a streaming chat that forgot the guard).
 *
 * If a future route legitimately streams `message_chunk` from an LLM but routes
 * its guard through a helper this test cannot see, add it to KNOWN_GUARD_TOKENS
 * (the guard-reference vocabulary) or — only with a documented reason — to
 * HEURISTIC_ALLOWLIST below.
 *
 * Pure static analysis: reads file TEXT off disk. No imports of the route
 * modules, no provider calls, no I/O beyond `fs.readFileSync`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// `src/routes/__tests__/` → the routes root is one directory up.
const ROUTES_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Vocabulary that counts as "this file references the egress guard". Any one
 * of these substrings present in a file's text satisfies the guard requirement
 * — the canonical singleton accessor, the route-level wrappers in brain.hono,
 * and the synthetic-principal wrapper in public-chat.
 */
const KNOWN_GUARD_TOKENS: ReadonlyArray<string> = Object.freeze([
  'getEgressFilter',
  'guardFinalText',
  'guardStreamText',
  'guardPublicFrame',
  'guardToolArgs',
  'guardPublicText',
]);

/**
 * Routes we KNOW emit model-derived text to the client (streaming or final)
 * and MUST therefore reference the egress guard. Paths are relative to the
 * routes root. brain-voice (transcript) + brain-dispatch (sub-MD chain) emit
 * model text on frames OTHER than `message_chunk`, so the heuristic would not
 * see them — the known-list is their coverage anchor.
 */
const KNOWN_MODEL_TEXT_ROUTES: ReadonlyArray<string> = Object.freeze([
  'brain.hono.ts',
  'brain-teach.hono.ts',
  'mining/chat.hono.ts',
  'brain-voice.hono.ts',
  'brain-dispatch.hono.ts',
  'public-chat.hono.ts',
]);

/**
 * Heuristic allow-list — files that match BOTH heuristic signals but are
 * legitimately exempt. EMPTY today. Add an entry ONLY with a documented reason
 * (e.g. a fixture/mock route that never reaches a real client). Adding a real
 * surface here to silence the tripwire is a security regression — don't.
 */
const HEURISTIC_ALLOWLIST: ReadonlyArray<string> = Object.freeze([]);

/** Signals that a file streams raw model text in `message_chunk` SSE frames. */
const MESSAGE_CHUNK_SIGNALS: ReadonlyArray<RegExp> = Object.freeze([
  /message_chunk/,
]);

/**
 * Signals that a file calls an LLM / orchestrator (i.e. the streamed text is
 * model-DERIVED, not a static string). Conservative + specific to avoid
 * matching incidental words.
 */
const LLM_SIGNALS: ReadonlyArray<RegExp> = Object.freeze([
  /\.invoke\(/, // BrainLLMClient.invoke(...)
  /brain-llm-router/, // the LLM router package
  /universal-client/, // the universal LLM adapter
  /streamTurn/, // orchestrator streaming entrypoint
  /runTurn/, // orchestrator turn entrypoint
  /orchestrator/i, // brain orchestrator wiring
  /central-intelligence\/kernel/, // the brain kernel
]);

function listHonoRouteFiles(): string[] {
  const entries = readdirSync(ROUTES_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.hono.ts')) continue;
    // `parentPath` (node 20.12+) is the directory of the entry.
    const dir = (entry as { parentPath?: string; path?: string }).parentPath
      ?? (entry as { path?: string }).path
      ?? ROUTES_DIR;
    const abs = join(dir, entry.name);
    // Skip anything inside a __tests__ folder (test fixtures, not routes).
    // Normalise separators so the check holds on Windows + POSIX.
    if (abs.split('\\').join('/').includes('/__tests__/')) continue;
    files.push(abs);
  }
  return files.sort();
}

function relPath(abs: string): string {
  return relative(ROUTES_DIR, abs).split('\\').join('/');
}

function referencesGuard(text: string): boolean {
  return KNOWN_GUARD_TOKENS.some((token) => text.includes(token));
}

function matchesAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((re) => re.test(text));
}

describe('egress-coverage (SEC-4 static firewall tripwire)', () => {
  it('discovers the route tree (sanity — the scan is not empty)', () => {
    const files = listHonoRouteFiles();
    // A non-empty route tree proves the glob actually walked the dir; an empty
    // result would make every other assertion vacuously pass.
    expect(files.length).toBeGreaterThan(10);
  });

  it('every KNOWN model-text route references the egress guard', () => {
    const missing: string[] = [];
    for (const rel of KNOWN_MODEL_TEXT_ROUTES) {
      const abs = join(ROUTES_DIR, rel);
      let text: string;
      try {
        text = readFileSync(abs, 'utf8');
      } catch {
        // A known route file that no longer exists is itself a regression
        // (the route was moved/renamed without updating this list).
        missing.push(`${rel} (file not found)`);
        continue;
      }
      if (!referencesGuard(text)) {
        missing.push(`${rel} (no egress-guard reference)`);
      }
    }
    expect(
      missing,
      `These KNOWN model-text routes must reference the egress guard ` +
        `(one of ${KNOWN_GUARD_TOKENS.join(', ')}):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('HEURISTIC: no route both streams message_chunk AND calls an LLM without the egress guard', () => {
    const offenders: string[] = [];
    for (const abs of listHonoRouteFiles()) {
      const rel = relPath(abs);
      if (HEURISTIC_ALLOWLIST.includes(rel)) continue;
      const text = readFileSync(abs, 'utf8');
      const streamsModelText = matchesAny(text, MESSAGE_CHUNK_SIGNALS);
      const callsLlm = matchesAny(text, LLM_SIGNALS);
      // Conservative: require BOTH signals before flagging (a non-streaming
      // LLM route, or a non-LLM stream, is not a model-prose-to-client leak).
      if (streamsModelText && callsLlm && !referencesGuard(text)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `These routes stream model_chunk text from an LLM but do NOT reference ` +
        `the egress guard — they can leak raw model prose to the client. ` +
        `Route the user-visible text through getEgressFilter()/guardPublicText ` +
        `(fail-closed), or — only with a documented reason — add to ` +
        `HEURISTIC_ALLOWLIST.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the heuristic actually flags an unguarded model-text stream (self-test)', () => {
    // Prove the heuristic is not vacuous: a synthetic file body that streams
    // message_chunk from an LLM but lacks any guard token MUST be caught.
    const fakeUnguarded =
      `await stream.writeSSE({ event: 'message_chunk', data: text });\n` +
      `const r = await client.invoke(request);`;
    const streams = matchesAny(fakeUnguarded, MESSAGE_CHUNK_SIGNALS);
    const llm = matchesAny(fakeUnguarded, LLM_SIGNALS);
    expect(streams && llm && !referencesGuard(fakeUnguarded)).toBe(true);

    // And the SAME body WITH a guard token must NOT be flagged.
    const fakeGuarded = `${fakeUnguarded}\nconst safe = getEgressFilter();`;
    expect(referencesGuard(fakeGuarded)).toBe(true);
  });
});
