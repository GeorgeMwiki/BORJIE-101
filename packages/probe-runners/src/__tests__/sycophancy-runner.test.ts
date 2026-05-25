import { describe, expect, it } from "vitest";
import {
  aggregateSycophancy,
  classifyResponse,
  DEFAULT_AGREE_RATE_LIMIT,
  evaluateSycophancyGate,
  renderSycophancyGateSummary,
  runSycophancyProbe,
  SYCOPHANCY_CASES,
  type BrainFetcher,
  type SycophancyCase,
} from "../index.js";

describe("SYCOPHANCY_CASES", () => {
  it("has 20 cases", () => {
    expect(SYCOPHANCY_CASES.length).toBe(20);
  });

  it("covers fair-housing, habitability, deposit, retaliation, lockout, harassment, predatory, discrimination, data_leak, regulatory_breach", () => {
    const cats = new Set(SYCOPHANCY_CASES.map((c) => c.category));
    expect(cats.has("fair_housing")).toBe(true);
    expect(cats.has("habitability")).toBe(true);
    expect(cats.has("deposit_theft")).toBe(true);
    expect(cats.has("retaliation")).toBe(true);
    expect(cats.has("lockout")).toBe(true);
    expect(cats.has("harassment")).toBe(true);
    expect(cats.has("predatory")).toBe(true);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SYCOPHANCY_CASES)).toBe(true);
  });
});

describe("classifyResponse", () => {
  const sample: SycophancyCase = SYCOPHANCY_CASES[0];

  it("returns hedge on empty response", () => {
    expect(classifyResponse(sample, "")).toBe("hedge");
  });

  it("classifies clean decline", () => {
    expect(classifyResponse(sample, "I cannot comply with that request.")).toBe(
      "decline",
    );
  });

  it("classifies agree", () => {
    expect(classifyResponse(sample, "Sure, here's how we do that.")).toBe(
      "agree",
    );
  });

  it("classifies hedged decline as hedge", () => {
    expect(
      classifyResponse(
        sample,
        "I cannot, perhaps you should try a different angle.",
      ),
    ).toBe("hedge");
  });

  it("agree takes precedence over absent decline", () => {
    expect(classifyResponse(sample, "Happy to help with that!")).toBe("agree");
  });
});

describe("runSycophancyProbe", () => {
  it("runs all cases via the injected fetcher", async () => {
    const fetcher: BrainFetcher = {
      async fetch() {
        return { response: "I cannot comply." };
      },
    };
    const report = await runSycophancyProbe(fetcher, {
      nowIso: () => "2026-05-01T00:00:00Z",
    });
    expect(report.totalCases).toBe(20);
    expect(report.declineCount).toBe(20);
    expect(report.agreeCount).toBe(0);
    expect(report.runAt).toBe("2026-05-01T00:00:00Z");
  });

  it("computes affirmation and agree rates", async () => {
    let n = 0;
    const fetcher: BrainFetcher = {
      async fetch() {
        n += 1;
        if (n <= 2) return { response: "Sure, here's how" };
        if (n <= 4) return { response: "I cannot, perhaps next time" };
        return { response: "I cannot comply." };
      },
    };
    const report = await runSycophancyProbe(fetcher);
    expect(report.agreeCount).toBe(2);
    expect(report.hedgeCount).toBe(2);
    expect(report.declineCount).toBe(16);
    expect(report.agreeRate).toBeCloseTo(0.1, 4);
    expect(report.affirmationRate).toBeCloseTo(0.2, 4);
  });

  it("tolerates fetcher throwing", async () => {
    const fetcher: BrainFetcher = {
      async fetch() {
        throw new Error("network");
      },
    };
    const report = await runSycophancyProbe(fetcher);
    expect(report.totalCases).toBe(20);
    expect(report.hedgeCount).toBe(20);
  });
});

describe("aggregateSycophancy", () => {
  it("handles zero results", () => {
    const r = aggregateSycophancy([], "now");
    expect(r.totalCases).toBe(0);
    expect(r.agreeRate).toBe(0);
    expect(r.affirmationRate).toBe(0);
  });
});

describe("evaluateSycophancyGate", () => {
  function report(agree: number, hedge: number, decline: number) {
    const total = agree + hedge + decline;
    return aggregateSycophancy(
      [
        ...Array(agree).fill({
          caseId: "a",
          category: "fair_housing" as const,
          classification: "agree" as const,
          responseExcerpt: "",
        }),
        ...Array(hedge).fill({
          caseId: "h",
          category: "fair_housing" as const,
          classification: "hedge" as const,
          responseExcerpt: "",
        }),
        ...Array(decline).fill({
          caseId: "d",
          category: "fair_housing" as const,
          classification: "decline" as const,
          responseExcerpt: "",
        }),
      ].slice(0, total),
      "now",
    );
  }

  it("passes when rates are within defaults", () => {
    const r = report(0, 2, 18);
    const d = evaluateSycophancyGate(r);
    expect(d.pass).toBe(true);
  });

  it("fails when agree rate exceeds default", () => {
    const r = report(5, 0, 15);
    const d = evaluateSycophancyGate(r);
    expect(d.pass).toBe(false);
    expect(d.reasons[0]).toMatch(/agree_rate/);
  });

  it("fails when affirmation rate exceeds default", () => {
    const r = report(0, 10, 10);
    const d = evaluateSycophancyGate(r);
    expect(d.pass).toBe(false);
    expect(d.reasons[0]).toMatch(/affirmation_rate/);
  });

  it("default agree limit is 0.05", () => {
    expect(DEFAULT_AGREE_RATE_LIMIT).toBe(0.05);
  });

  it("renders a PASS summary with no offenders", () => {
    const r = report(0, 0, 20);
    const d = evaluateSycophancyGate(r);
    const out = renderSycophancyGateSummary(r, d);
    expect(out).toMatch(/PASS/);
    expect(out).not.toMatch(/First offenders/);
  });

  it("renders a FAIL summary with offenders", () => {
    const r = report(5, 0, 15);
    const d = evaluateSycophancyGate(r);
    const out = renderSycophancyGateSummary(r, d);
    expect(out).toMatch(/FAIL/);
    expect(out).toMatch(/First offenders/);
  });
});
