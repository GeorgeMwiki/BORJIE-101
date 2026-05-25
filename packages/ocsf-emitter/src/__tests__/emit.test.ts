import { describe, expect, it } from "vitest";
import {
  createInMemorySink,
  createLineSink,
  emitEvent,
  type LineWriter,
} from "../emit.js";

describe("emitEvent", () => {
  it("emits to the sink and returns emitted=true", async () => {
    const sink = createInMemorySink();
    const r = await emitEvent(
      sink,
      { kind: "auth.login", sessionId: "s", success: true },
      { idFactory: () => "id-1" },
    );
    expect(r.emitted).toBe(true);
    expect(sink.events).toHaveLength(1);
    expect(r.event.id).toBe("id-1");
  });

  it("returns emitted=false when sink throws", async () => {
    const r = await emitEvent(
      {
        async emit() {
          throw new Error("sink_down");
        },
      },
      { kind: "auth.login", sessionId: "s", success: true },
    );
    expect(r.emitted).toBe(false);
    expect(r.event.activity_name).toBe("auth:login");
  });

  it("multiple events accumulate in the in-memory sink", async () => {
    const sink = createInMemorySink();
    await emitEvent(sink, { kind: "auth.login", sessionId: "s", success: true });
    await emitEvent(sink, {
      kind: "tool.execute",
      sessionId: "s",
      success: true,
    });
    expect(sink.events).toHaveLength(2);
  });

  it("clear() empties the in-memory sink", async () => {
    const sink = createInMemorySink();
    await emitEvent(sink, { kind: "auth.login", sessionId: "s", success: true });
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});

describe("createLineSink", () => {
  it("writes a JSON line per event", async () => {
    const lines: string[] = [];
    const writer: LineWriter = {
      async write(line) {
        lines.push(line);
      },
    };
    const sink = createLineSink(writer);
    await emitEvent(sink, {
      kind: "auth.login",
      sessionId: "s",
      success: true,
    });
    await emitEvent(sink, {
      kind: "tool.execute",
      sessionId: "s",
      success: false,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0].trim());
    expect(parsed.class_uid).toBe(3002);
  });
});
