import { describe, expect, it } from "vitest";
import {
  buildMemoryCreate,
  buildMemoryDelete,
  buildMemoryList,
  buildMemoryRead,
  buildMemoryUpdate,
  memoryWireToTopicFiles,
  pathToTopic,
  topicFilesToMemoryWire,
  topicToPath,
} from "../adapter.js";

describe("topicToPath / pathToTopic", () => {
  it("round-trips simple topics", () => {
    expect(topicToPath("rent-roll")).toBe("/memories/rent-roll.md");
    expect(pathToTopic("/memories/rent-roll.md")).toBe("rent-roll");
  });

  it("returns null for non-memory paths", () => {
    expect(pathToTopic("/data/rent.md")).toBeNull();
    expect(pathToTopic("/memories/rent.txt")).toBeNull();
    expect(pathToTopic("rent.md")).toBeNull();
  });
});

describe("topicFilesToMemoryWire", () => {
  it("converts a single snapshot", () => {
    const { files, errors } = topicFilesToMemoryWire([
      { topic: "tenants", content: "list of tenants" },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("/memories/tenants.md");
    expect(files[0].content).toBe("list of tenants");
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid topic names with structured error", () => {
    const { files, errors } = topicFilesToMemoryWire([
      { topic: "BadTopic", content: "x" },
    ]);
    expect(files).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("invalid_topic");
    expect(errors[0].offending).toBe("BadTopic");
  });

  it("accepts topics with digits and dashes", () => {
    const { files, errors } = topicFilesToMemoryWire([
      { topic: "tenant-2026-q1", content: "x" },
    ]);
    expect(files).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("rejects topics starting with a dash", () => {
    const { files, errors } = topicFilesToMemoryWire([
      { topic: "-bad", content: "x" },
    ]);
    expect(files).toHaveLength(0);
    expect(errors[0].kind).toBe("invalid_topic");
  });

  it("dedupes by topic, keeping more-recent lastModifiedIso", () => {
    const { files, errors } = topicFilesToMemoryWire([
      {
        topic: "rent",
        content: "old",
        lastModifiedIso: "2026-01-01T00:00:00Z",
      },
      {
        topic: "rent",
        content: "new",
        lastModifiedIso: "2026-02-01T00:00:00Z",
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("new");
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("duplicate_topic");
  });

  it("propagates lastModifiedIso to the wire file", () => {
    const { files } = topicFilesToMemoryWire([
      {
        topic: "x",
        content: "y",
        lastModifiedIso: "2026-05-01T00:00:00Z",
      },
    ]);
    expect(files[0].lastModifiedIso).toBe("2026-05-01T00:00:00Z");
  });
});

describe("memoryWireToTopicFiles", () => {
  it("converts a single wire file", () => {
    const { snapshots, errors } = memoryWireToTopicFiles([
      { path: "/memories/leases.md", content: "lease 1" },
    ]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].topic).toBe("leases");
    expect(errors).toHaveLength(0);
  });

  it("rejects non-/memories/ paths", () => {
    const { snapshots, errors } = memoryWireToTopicFiles([
      { path: "/data/x.md", content: "hi" },
    ]);
    expect(snapshots).toHaveLength(0);
    expect(errors[0].kind).toBe("invalid_path");
  });

  it("rejects empty content (spec disallows)", () => {
    const { snapshots, errors } = memoryWireToTopicFiles([
      { path: "/memories/empty.md", content: "" },
    ]);
    expect(snapshots).toHaveLength(0);
    expect(errors[0].kind).toBe("empty_content");
  });

  it("rejects bad topic segment inside a valid-prefix path", () => {
    const { snapshots, errors } = memoryWireToTopicFiles([
      { path: "/memories/Bad-Cap.md", content: "x" },
    ]);
    expect(snapshots).toHaveLength(0);
    expect(errors[0].kind).toBe("invalid_topic");
  });

  it("propagates lastModifiedIso from wire to snapshot", () => {
    const { snapshots } = memoryWireToTopicFiles([
      {
        path: "/memories/a.md",
        content: "b",
        lastModifiedIso: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(snapshots[0].lastModifiedIso).toBe("2026-06-01T00:00:00Z");
  });
});

describe("round-trip", () => {
  it("BORJIE -> wire -> BORJIE preserves topic + content", () => {
    const original = [
      { topic: "tenants", content: "tenant data" },
      { topic: "rent-roll", content: "rent data" },
    ];
    const { files } = topicFilesToMemoryWire(original);
    const { snapshots } = memoryWireToTopicFiles(files);
    expect(snapshots).toHaveLength(2);
    const sorted = [...snapshots].sort((a, b) =>
      a.topic.localeCompare(b.topic),
    );
    expect(sorted[0].topic).toBe("rent-roll");
    expect(sorted[1].topic).toBe("tenants");
    expect(sorted[1].content).toBe("tenant data");
  });
});

describe("command builders", () => {
  it("buildMemoryCreate produces correct shape", () => {
    const cmd = buildMemoryCreate("x", "y");
    expect(cmd).toEqual({
      action: "create",
      path: "/memories/x.md",
      content: "y",
    });
  });

  it("buildMemoryRead", () => {
    expect(buildMemoryRead("x")).toEqual({
      action: "read",
      path: "/memories/x.md",
    });
  });

  it("buildMemoryUpdate", () => {
    expect(buildMemoryUpdate("a", "b")).toEqual({
      action: "update",
      path: "/memories/a.md",
      content: "b",
    });
  });

  it("buildMemoryDelete", () => {
    expect(buildMemoryDelete("z")).toEqual({
      action: "delete",
      path: "/memories/z.md",
    });
  });

  it("buildMemoryList", () => {
    expect(buildMemoryList()).toEqual({ action: "list", dir: "/memories/" });
  });
});
