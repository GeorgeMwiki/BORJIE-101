/**
 * Streaming-artifact contract tests (LP-24b).
 *
 * Covers the stream parser (chunk-split tags, malformed tags, flush),
 * the typed StreamingArtifact writer + reducer (schema/partial/final/
 * error, stale-chunk rejection, closed-writer guard), and the
 * choreography state machine (timed reveals, voice markers, interaction).
 */

import { describe, expect, it, vi } from "vitest";
import {
  createChatArtifactStreamParser,
  type ArtifactStreamEvent,
} from "../streaming/artifact-stream-parser";
import {
  createArtifactWriter,
  createInMemoryArtifactTransport,
  reduceArtifactChunk,
  assembleArtifact,
  type ArtifactChunk,
  type StreamingArtifact,
} from "../streaming/streaming-artifact";
import {
  initChoreographyState,
  tickChoreography,
  applyInteraction,
} from "../streaming/choreography-engine";
import type { BlackboardChoreography } from "../streaming/choreography";

function collect() {
  const events: ArtifactStreamEvent[] = [];
  const sink = (e: ArtifactStreamEvent): void => {
    events.push(e);
  };
  return { events, sink };
}

describe("artifact-stream-parser", () => {
  it("emits open/delta/close for a well-formed artifact in one chunk", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed(
      'chat text <artifact id="a1" type="comparison_table" title="Licences">body here</artifact> trailing',
    );
    parser.flush();

    const open = events.find((e) => e.type === "open");
    const close = events.find((e) => e.type === "close");
    expect(open).toMatchObject({
      type: "open",
      artifactId: "a1",
      artifactType: "comparison_table",
      title: "Licences",
    });
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(close).toMatchObject({ type: "close", artifactId: "a1" });
    if (close && close.type === "close") {
      expect(close.content).toBe("body here");
    }
  });

  it("reassembles a tag split across many chunks", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    for (const c of [
      "<arti",
      'fact id="x" ',
      'type="kpi" title="T">he',
      "llo",
      " wor",
      "ld</arti",
      "fact>",
    ]) {
      parser.feed(c);
    }
    parser.flush();

    const open = events.find((e) => e.type === "open");
    expect(open).toMatchObject({ artifactId: "x", artifactType: "kpi" });
    const close = events.find((e) => e.type === "close");
    expect(close && close.type === "close" ? close.content : "").toBe(
      "hello world",
    );
  });

  it("drops a malformed open tag (missing type) and resumes", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed('<artifact id="only-id">junk</artifact>');
    parser.feed('<artifact id="ok" type="kpi">good</artifact>');
    parser.flush();

    const opens = events.filter((e) => e.type === "open");
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ artifactId: "ok" });
  });

  it("defangs nested artifact tags inside the safe body projection", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed(
      '<artifact id="a" type="md">before <artifact id="evil" type="x"> after</artifact>',
    );
    parser.flush();
    const close = events.find((e) => e.type === "close");
    if (close && close.type === "close") {
      expect(close.safeContent).not.toContain("<artifact");
      expect(close.safeContent).toContain("&lt;artifact");
    }
  });

  it("entity-encodes a <script> payload in the safe body projection", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed(
      '<artifact id="x" type="md">hi <script>alert(1)</script> bye</artifact>',
    );
    parser.flush();
    const close = events.find((e) => e.type === "close");
    expect(close && close.type === "close").toBe(true);
    if (close && close.type === "close") {
      // Raw content is preserved verbatim (UNSAFE projection).
      expect(close.content).toContain("<script>");
      // Safe projection must NOT contain an executable tag.
      expect(close.safeContent).not.toContain("<script>");
      expect(close.safeContent).toContain("&lt;script&gt;");
    }
  });

  it("entity-encodes an <img onerror> payload across delta + close", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed('<artifact id="y" type="md">');
    parser.feed('<img src=x onerror=alert(1)>');
    parser.feed("</artifact>");
    parser.flush();

    const delta = events.find((e) => e.type === "delta");
    if (delta && delta.type === "delta") {
      expect(delta.safeDelta).not.toContain("<img");
      expect(delta.safeDelta).toContain("&lt;img");
      expect(delta.safeDelta).not.toContain('"');
    }
    const close = events.find((e) => e.type === "close");
    if (close && close.type === "close") {
      expect(close.safeContent).not.toContain("<img");
      expect(close.safeContent).toContain("&lt;img");
    }
  });

  it("encodes ampersands and stray closing tags so nothing renders as markup", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed('<artifact id="z" type="md">a & b </div></artifact>');
    parser.flush();
    const close = events.find((e) => e.type === "close");
    if (close && close.type === "close") {
      expect(close.safeContent).toContain("&amp;");
      expect(close.safeContent).not.toContain("</div>");
      expect(close.safeContent).toContain("&lt;/div&gt;");
    }
  });

  it("rejects a title that tries to break out of the title attribute", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    // A double-quote in the title would break `title="..."`; the tightened
    // charset rejects it, so the title falls back to the type, and the
    // emitted title carries no raw quote regardless.
    parser.feed(
      '<artifact id="t1" type="kpi" title=\'x" onmouseover="alert(1)\'>body</artifact>',
    );
    parser.flush();
    const open = events.find((e) => e.type === "open");
    expect(open && open.type === "open").toBe(true);
    if (open && open.type === "open") {
      expect(open.title).not.toContain('"');
      expect(open.title).not.toContain("onmouseover");
      // Rejected -> falls back to the artifact type.
      expect(open.title).toBe("kpi");
    }
  });

  it("entity-encodes angle-bracket attempts inside an otherwise-valid title flow", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    // Title with a quote is rejected (falls back to type); assert the
    // emitted title never carries a raw quote or bracket on open OR close.
    parser.feed(
      '<artifact id="t2" type="comparison_table" title=\'A">B\'>body</artifact>',
    );
    parser.flush();
    const open = events.find((e) => e.type === "open");
    const close = events.find((e) => e.type === "close");
    if (open && open.type === "open") {
      expect(open.title).not.toContain('"');
      expect(open.title).not.toContain(">");
    }
    if (close && close.type === "close") {
      expect(close.title).not.toContain('"');
      expect(close.title).not.toContain(">");
    }
  });

  it("preserves a clean title unchanged through entity encoding", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed(
      '<artifact id="t3" type="kpi" title="Licence options (2026)">body</artifact>',
    );
    parser.flush();
    const open = events.find((e) => e.type === "open");
    if (open && open.type === "open") {
      expect(open.title).toBe("Licence options (2026)");
    }
  });

  it("implicitly closes an unclosed artifact at flush", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed('<artifact id="u" type="md">no close tag here');
    expect(parser.isInsideArtifact()).toBe(true);
    parser.flush();
    const close = events.find((e) => e.type === "close");
    expect(close).toBeDefined();
    expect(parser.isInsideArtifact()).toBe(false);
  });

  it("parses attributes in any order, first occurrence winning", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    parser.feed(
      '<artifact title="First" type="kpi" id="ord" id="ignored">b</artifact>',
    );
    parser.flush();
    const open = events.find((e) => e.type === "open");
    expect(open).toMatchObject({
      artifactId: "ord",
      artifactType: "kpi",
      title: "First",
    });
  });

  it("handles a pathological open tag without super-linear blow-up (ReDoS guard)", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    // A long run of attribute-name characters that never reaches a value
    // would force quadratic backtracking under the old regex. The bounded,
    // sticky tokenizer must chew through it in linear time.
    const evil =
      "<artifact " + "a".repeat(100_000) + " " + " ".repeat(100_000) + ">body";
    const start = Date.now();
    parser.feed(evil);
    parser.flush();
    const elapsed = Date.now() - start;
    // Linear scan of ~200k chars is microseconds; allow generous slack.
    expect(elapsed).toBeLessThan(500);
    // Over-long / value-less tag yields no valid open (missing id+type).
    expect(events.filter((e) => e.type === "open")).toHaveLength(0);
  });

  it("stays linear when a quoted value is pathologically unterminated", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    // An unterminated quote whose huge body contains the first `>` makes
    // the whole open tag exceed the length cap; it must be rejected in
    // linear time, never triggering a quadratic scan.
    const evil =
      '<artifact id="ok" type="kpi" title="' + "x".repeat(100_000) + ">tail";
    const start = Date.now();
    parser.feed(evil);
    parser.flush();
    expect(Date.now() - start).toBeLessThan(500);
    // Over the MAX_OPEN_TAG_LENGTH cap -> no valid open emitted.
    expect(events.filter((e) => e.type === "open")).toHaveLength(0);
  });

  it("still emits an open when id+type precede a bounded title flow", () => {
    const { events, sink } = collect();
    const parser = createChatArtifactStreamParser(sink);
    // A normal-length tag with all three attributes still parses cleanly
    // after the rewrite (behavior preserved for the happy path).
    parser.feed('<artifact id="ok" type="kpi" title="Bounded">body</artifact>');
    parser.flush();
    const open = events.find((e) => e.type === "open");
    expect(open).toMatchObject({
      artifactId: "ok",
      artifactType: "kpi",
      title: "Bounded",
    });
  });

  it("tokenizes an under-cap adversarial attribute soup in linear time", () => {
    // This input is UNDER the open-tag length cap, so it exercises the
    // tokenizer regex directly (not the length short-circuit). It is a
    // dense run of name-only tokens with no `=value` — the exact shape that
    // forced quadratic backtracking before. Parsing it thousands of times
    // must stay fast, proving the bounded sticky regex is linear.
    const soup =
      "<artifact " + "ab ".repeat(300) + 'id="z" type="kpi">b</artifact>';
    expect(soup.indexOf(">")).toBeLessThan(1024); // header within the cap
    const start = Date.now();
    let opens = 0;
    for (let i = 0; i < 2000; i += 1) {
      const { events, sink } = collect();
      const parser = createChatArtifactStreamParser(sink);
      parser.feed(soup);
      parser.flush();
      if (events.some((e) => e.type === "open")) opens += 1;
    }
    expect(Date.now() - start).toBeLessThan(1000);
    // The trailing id+type are still recovered despite the leading soup.
    expect(opens).toBe(2000);
  });
});

describe("streaming-artifact writer + reducer", () => {
  interface Card {
    title: string;
    value: number;
    note: string;
  }

  it("publishes schema -> partial -> final chunks with monotonic seq", async () => {
    const transport = createInMemoryArtifactTransport();
    let t = 100;
    const writer = createArtifactWriter<Card>("c1", transport, {
      now: () => (t += 1),
    });

    await writer.schema({ title: "Royalty" });
    await writer.partial({ value: 7 });
    await writer.final({ title: "Royalty", value: 7, note: "TZS" });

    const chunks = transport.consume();
    expect(chunks.map((c) => c.kind)).toEqual(["schema", "partial", "final"]);
    expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(transport.isClosed()).toBe(true);
    expect(writer.closed()).toBe(true);
  });

  it("assembles chunks into a complete typed snapshot", async () => {
    const transport = createInMemoryArtifactTransport();
    const writer = createArtifactWriter<Card>("c2", transport);
    await writer.schema({ title: "X" });
    await writer.partial({ value: 3 });
    await writer.final({ title: "X", value: 5, note: "n" });

    const snap = assembleArtifact<Card>(
      transport.consume() as ArtifactChunk<Card>[],
    );
    expect(snap?.status).toBe("complete");
    expect(snap?.value).toEqual({ title: "X", value: 5, note: "n" });
  });

  it("surfaces an error chunk as error status", async () => {
    const transport = createInMemoryArtifactTransport();
    const writer = createArtifactWriter<Card>("c3", transport);
    await writer.schema({ title: "X" });
    await writer.fail("provider exhausted");

    const snap = assembleArtifact<Card>(
      transport.consume() as ArtifactChunk<Card>[],
    );
    expect(snap?.status).toBe("error");
    expect(snap?.error).toBe("provider exhausted");
  });

  it("throws when writing after the stream is closed", async () => {
    const transport = createInMemoryArtifactTransport();
    const writer = createArtifactWriter<Card>("c4", transport);
    await writer.final({ title: "X", value: 1, note: "n" });
    await expect(writer.partial({ value: 2 })).rejects.toThrow(/closed/);
  });

  it("reducer ignores stale / out-of-order chunks", () => {
    let snap: StreamingArtifact<Card> | undefined;
    snap = reduceArtifactChunk(snap, {
      artifactId: "c5",
      kind: "partial",
      data: { value: 1 },
      seq: 2,
      emittedAt: 0,
    });
    // Stale seq (1 <= lastSeq 2) must be ignored.
    const after = reduceArtifactChunk(snap, {
      artifactId: "c5",
      kind: "partial",
      data: { value: 999 },
      seq: 1,
      emittedAt: 0,
    });
    expect(after).toBe(snap);
    expect(after?.value.value).toBe(1);
  });

  it("reducer ignores chunks for a different artifact id", () => {
    const snap = reduceArtifactChunk<Card>(undefined, {
      artifactId: "c6",
      kind: "schema",
      data: { title: "A" },
      seq: 1,
      emittedAt: 0,
    });
    const after = reduceArtifactChunk(snap, {
      artifactId: "other",
      kind: "partial",
      data: { value: 1 },
      seq: 2,
      emittedAt: 0,
    });
    expect(after).toBe(snap);
  });
});

describe("choreography-engine", () => {
  const choreo: BlackboardChoreography = {
    reveals: [
      { targetId: "a", atMs: 0 },
      { targetId: "b", atMs: 100 },
      { targetId: "c", atMs: 300 },
    ],
    voice: [
      { atMs: 0, text: "Karibu" },
      { atMs: 200, text: "Angalia hapa" },
    ],
    shapes: [{ id: "s1", kind: "box" }],
    responses: [
      {
        onEvent: "tap-b",
        reveal: [{ targetId: "z", atMs: 0 }],
        say: { atMs: 0, text: "Asante" },
        setShapes: [{ id: "s2", kind: "circle" }],
      },
    ],
  };

  it("reveals progressively as elapsed time advances", () => {
    let state = initChoreographyState(choreo);
    expect(state.revealed.size).toBe(0);

    let r = tickChoreography(state, choreo, 0);
    state = r.state;
    expect(state.revealed.has("a")).toBe(true);
    expect(r.events.newlySpoken.map((v) => v.text)).toContain("Karibu");

    r = tickChoreography(state, choreo, 150);
    state = r.state;
    expect(state.revealed.has("b")).toBe(true);
    expect(state.revealed.has("c")).toBe(false);
    expect(state.finished).toBe(false);

    r = tickChoreography(state, choreo, 300);
    state = r.state;
    expect(state.revealed.has("c")).toBe(true);
    expect(state.finished).toBe(true);
  });

  it("fires each voice marker exactly once", () => {
    let state = initChoreographyState(choreo);
    const spoken: string[] = [];
    for (const ms of [0, 50, 200, 250, 300]) {
      const r = tickChoreography(state, choreo, ms);
      state = r.state;
      for (const v of r.events.newlySpoken) spoken.push(v.text);
    }
    expect(spoken).toEqual(["Karibu", "Angalia hapa"]);
  });

  it("returns the same state reference on an idle tick", () => {
    let state = initChoreographyState(choreo);
    state = tickChoreography(state, choreo, 300).state; // finish
    const r = tickChoreography(state, choreo, 300);
    expect(r.state).toBe(state);
    expect(r.events.newlyRevealed).toHaveLength(0);
  });

  it("applies an interaction response (reveal + shape + voice)", () => {
    const state = initChoreographyState(choreo);
    const { state: next, spoke } = applyInteraction(state, choreo, "tap-b");
    expect(next.revealed.has("z")).toBe(true);
    expect(next.shapes.some((s) => s.id === "s2")).toBe(true);
    expect(spoke?.text).toBe("Asante");
  });

  it("is a no-op for an unknown interaction event", () => {
    const state = initChoreographyState(choreo);
    const { state: next, spoke } = applyInteraction(state, choreo, "unknown");
    expect(next).toBe(state);
    expect(spoke).toBeUndefined();
  });
});
