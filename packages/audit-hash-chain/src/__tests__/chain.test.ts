import { describe, expect, it } from "vitest";
import {
  appendEntry,
  chainHash,
  hashChainEntry,
  verifyChain,
} from "../chain.js";
import { GENESIS_HASH, type ChainEntry } from "../types.js";

describe("chainHash — determinism", () => {
  it("produces the same hash for the same input", () => {
    const a = chainHash({ prev: GENESIS_HASH, payload: { event: "ev1" } });
    const b = chainHash({ prev: GENESIS_HASH, payload: { event: "ev1" } });
    expect(a).toBe(b);
  });

  it("produces a different hash for a different payload", () => {
    const a = chainHash({ prev: GENESIS_HASH, payload: { event: "ev1" } });
    const b = chainHash({ prev: GENESIS_HASH, payload: { event: "ev2" } });
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex string (sha256)", () => {
    const h = chainHash({ prev: GENESIS_HASH, payload: { x: 1 } });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("HMAC produces a different result than plain sha256", () => {
    const plain = chainHash({ prev: GENESIS_HASH, payload: { x: 1 } });
    const keyed = chainHash(
      { prev: GENESIS_HASH, payload: { x: 1 }, secretId: "k1" },
      "secret-value",
    );
    expect(plain).not.toBe(keyed);
  });

  it("HMAC with different secret values produces different hashes", () => {
    const a = chainHash(
      { prev: GENESIS_HASH, payload: { x: 1 }, secretId: "k1" },
      "alpha",
    );
    const b = chainHash(
      { prev: GENESIS_HASH, payload: { x: 1 }, secretId: "k1" },
      "beta",
    );
    expect(a).not.toBe(b);
  });
});

describe("hashChainEntry — convenience", () => {
  it("defaults prev to GENESIS when omitted", () => {
    const a = hashChainEntry({ payload: { x: 1 } });
    const b = chainHash({ prev: GENESIS_HASH, payload: { x: 1 } });
    expect(a).toBe(b);
  });

  it("supports explicit prev for chained call sites", () => {
    const a = hashChainEntry({ prev: "abc", payload: { x: 1 } });
    const b = chainHash({ prev: "abc", payload: { x: 1 } });
    expect(a).toBe(b);
  });
});

describe("appendEntry — chain construction", () => {
  it("creates a genesis entry at index 0 with GENESIS prevHash", () => {
    const next = appendEntry([], { event: "tenant_created" }, {
      sealedAtIso: "2026-01-01T00:00:00.000Z",
    });
    expect(next).toHaveLength(1);
    const entry = next[0];
    expect(entry.index).toBe(0);
    expect(entry.prevHash).toBe(GENESIS_HASH);
    expect(entry.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.payload).toEqual({ event: "tenant_created" });
    expect(entry.sealedAtIso).toBe("2026-01-01T00:00:00.000Z");
  });

  it("chains the second entry to the first", () => {
    const c1 = appendEntry([], { event: "a" });
    const c2 = appendEntry(c1, { event: "b" });
    expect(c2).toHaveLength(2);
    expect(c2[1].index).toBe(1);
    expect(c2[1].prevHash).toBe(c1[0].rowHash);
  });

  it("does not mutate the input chain (immutability)", () => {
    const initial = appendEntry([], { event: "a" });
    const before = [...initial];
    appendEntry(initial, { event: "b" });
    expect(initial).toEqual(before);
  });

  it("auto-stamps sealedAtIso when not provided", () => {
    const next = appendEntry([], { event: "x" });
    expect(next[0].sealedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records secretId when provided", () => {
    const next = appendEntry([], { event: "x" }, {
      secretId: "key-2026-01",
      secretValue: "hex-secret",
    });
    expect(next[0].secretId).toBe("key-2026-01");
  });
});

describe("verifyChain — integrity", () => {
  it("returns ok for an empty chain", () => {
    const r = verifyChain([]);
    expect(r.ok).toBe(true);
    expect(r.scanned).toBe(0);
  });

  it("returns ok for a single sealed entry", () => {
    const chain = appendEntry([], { event: "a" });
    const r = verifyChain(chain);
    expect(r.ok).toBe(true);
    expect(r.scanned).toBe(1);
  });

  it("returns ok for a multi-entry chain", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    for (let i = 0; i < 10; i += 1) {
      chain = appendEntry(chain, { event: `ev${i}`, i });
    }
    const r = verifyChain(chain);
    expect(r.ok).toBe(true);
    expect(r.scanned).toBe(10);
  });

  it("verifies a chain produced with HMAC secrets", () => {
    const ring = { "k-2026-01": "supersecret" };
    let chain: ReadonlyArray<ChainEntry> = [];
    for (let i = 0; i < 5; i += 1) {
      chain = appendEntry(chain, { i }, {
        secretId: "k-2026-01",
        secretValue: ring["k-2026-01"],
      });
    }
    const r = verifyChain(chain, ring);
    expect(r.ok).toBe(true);
  });
});

describe("verifyChain — tamper detection", () => {
  it("detects a payload mutation", () => {
    const c1 = appendEntry([], { event: "a", value: 100 });
    const tampered: ChainEntry[] = [
      { ...c1[0], payload: { event: "a", value: 999 } },
    ];
    const r = verifyChain(tampered);
    expect(r.ok).toBe(false);
    expect(r.firstBrokenIndex).toBe(0);
    expect(r.reason).toBe("row_hash_mismatch");
  });

  it("detects a prevHash mutation", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { event: "a" });
    chain = appendEntry(chain, { event: "b" });
    const tampered: ChainEntry[] = [
      chain[0],
      { ...chain[1], prevHash: "bogus" },
    ];
    const r = verifyChain(tampered);
    expect(r.ok).toBe(false);
    expect(r.firstBrokenIndex).toBe(1);
    expect(r.reason).toBe("prev_hash_mismatch");
  });

  it("detects an index mismatch (re-ordered entries)", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { event: "a" });
    chain = appendEntry(chain, { event: "b" });
    const swapped = [chain[1], chain[0]];
    const r = verifyChain(swapped);
    expect(r.ok).toBe(false);
    expect(r.firstBrokenIndex).toBe(0);
    expect(r.reason).toMatch(/^index_mismatch/);
  });

  it("detects a row-hash forgery attempt", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { event: "a" });
    const forged: ChainEntry[] = [
      { ...chain[0], rowHash: "f".repeat(64) },
    ];
    const r = verifyChain(forged);
    expect(r.ok).toBe(false);
    expect(r.firstBrokenIndex).toBe(0);
  });

  it("reports the expected vs actual hash for diagnostics", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { event: "a" });
    chain = appendEntry(chain, { event: "b" });
    const tampered: ChainEntry[] = [
      chain[0],
      { ...chain[1], prevHash: "0".repeat(64) },
    ];
    const r = verifyChain(tampered);
    expect(r.expectedHash).toBe(chain[0].rowHash);
    expect(r.actualHash).toBe("0".repeat(64));
  });
});

describe("verifyChain — secret rotation", () => {
  it("detects when a secret is unknown to the verifier", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { x: 1 }, {
      secretId: "rotated-key",
      secretValue: "hex",
    });
    const r = verifyChain(chain, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("secret_unknown_rotated-key");
  });

  it("verifies a chain spanning a secret rotation", () => {
    const ring = { "k-2026-01": "older", "k-2026-02": "newer" };
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { i: 0 }, {
      secretId: "k-2026-01",
      secretValue: ring["k-2026-01"],
    });
    chain = appendEntry(chain, { i: 1 }, {
      secretId: "k-2026-01",
      secretValue: ring["k-2026-01"],
    });
    chain = appendEntry(chain, { i: 2 }, {
      secretId: "k-2026-02",
      secretValue: ring["k-2026-02"],
    });
    const r = verifyChain(chain, ring);
    expect(r.ok).toBe(true);
    expect(r.scanned).toBe(3);
  });

  it("fails when the same chain is verified with a wrong secret value", () => {
    let chain: ReadonlyArray<ChainEntry> = [];
    chain = appendEntry(chain, { i: 0 }, {
      secretId: "k1",
      secretValue: "correct-secret",
    });
    const r = verifyChain(chain, { k1: "wrong-secret" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("row_hash_mismatch");
  });
});
