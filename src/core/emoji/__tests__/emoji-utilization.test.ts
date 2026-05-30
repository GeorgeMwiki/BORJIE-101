/**
 * Unit tests for the emoji utilization layer.
 *
 * Covers: universal-set integrity, channel-safety swap, stepper status
 * mapping, adverse-action softening, domain anchors, voice-ack, notification
 * subject prefix, application-journey state mapping, compliance traffic-light.
 *
 * Single test file — keeps runtime small and review surface tight.
 */

import { describe, it, expect } from "vitest";
import {
  UNIVERSAL_EMOJI,
  emojiLabel,
  getEmoji,
  safeEmojiChar,
} from "../universal-set";
import { stepStatusEmoji } from "../stepper-status";
import { softenAdverseAction } from "../adverse-action";
import { domainAnchor, domainAnchorPrefix } from "../domain-anchors";
import { voiceAckEmoji, voiceText, VOICE_STATES } from "../voice-ack";
import { prefixedSubject, NOTIFICATION_KINDS } from "../notification-prefix";
import {
  applicationJourneyState,
  applicationJourneyEmoji,
  applicationJourneyRail,
} from "../application-journey";
import {
  complianceLight,
  complianceHeader,
  riskScoreToLevel,
} from "../compliance-light";
import {
  officerTag,
  officerTagAriaLabel,
  OFFICER_TAGS,
} from "../officer-file-tags";

describe("universal-set", () => {
  it("exposes a frozen list of cross-cultural-safe emoji", () => {
    expect(UNIVERSAL_EMOJI.length).toBeGreaterThanOrEqual(20);
    expect(Object.isFrozen(UNIVERSAL_EMOJI)).toBe(true);
  });

  it("provides bilingual aria-labels for every emoji", () => {
    for (const def of UNIVERSAL_EMOJI) {
      expect(def.labelEn.length).toBeGreaterThan(0);
      expect(def.labelSw.length).toBeGreaterThan(0);
    }
  });

  it("swaps thumbs-up to check on west-africa channel", () => {
    expect(safeEmojiChar("thumbsUp", "west-africa")).toBe("✅");
    expect(safeEmojiChar("thumbsUp", "default")).toBe("👍");
  });

  it("throws on unknown emoji key", () => {
    // @ts-expect-error -- intentional invalid key for runtime guard
    expect(() => getEmoji("does-not-exist")).toThrow();
  });

  it("emojiLabel respects language", () => {
    expect(emojiLabel("seedling", "en")).toMatch(/start/i);
    expect(emojiLabel("seedling", "sw")).toMatch(/anza/i);
  });
});

describe("stepStatusEmoji", () => {
  it("maps the four step states to the canonical triad + flag", () => {
    expect(stepStatusEmoji("completed").char).toBe("✅");
    expect(stepStatusEmoji("in_progress").char).toBe("⏳");
    expect(stepStatusEmoji("not_started").char).toBe("🔒");
    expect(stepStatusEmoji("needs_attention").char).toBe("🚩");
  });
});

describe("softenAdverseAction", () => {
  it("prefixes the subject with prayer hands", () => {
    const out = softenAdverseAction({
      action: "loan_declined",
      reason: "Income proof needs more detail.",
    });
    expect(out.subject.startsWith("🙏")).toBe(true);
  });

  it("includes the borrower first name when provided", () => {
    const out = softenAdverseAction({
      action: "document_missing",
      firstName: "Asha",
      reason: "Please upload your business permit.",
    });
    expect(out.body).toContain("Asha");
  });

  it("supports Swahili", () => {
    const out = softenAdverseAction({
      action: "loan_declined",
      lang: "sw",
      reason: "Tunaangalia njia mbadala.",
    });
    expect(out.body).toContain("Habari");
    expect(out.subject).toMatch(/^🙏/);
  });

  it("never contains an em dash (Borjie Persona DNA invariant)", () => {
    const out = softenAdverseAction({
      action: "loan_declined",
      reason: "We will route alternatives to you within 48 hours.",
    });
    expect(out.body).not.toContain("—");
    expect(out.subject).not.toContain("—");
  });
});

describe("domainAnchor", () => {
  it("returns a stable anchor for known domains", () => {
    const anchor = domainAnchor("ENTREPRENEURSHIP_STRATEGY");
    expect(anchor?.char).toBe("🌱");
  });

  it("returns null for unknown domain ids", () => {
    expect(domainAnchor("NOT_A_DOMAIN")).toBeNull();
  });

  it("renders bilingual prefix", () => {
    expect(domainAnchorPrefix("CREDIT_LENDING", "en")).toMatch(/Credit/i);
    expect(domainAnchorPrefix("CREDIT_LENDING", "sw")).toMatch(/Mikopo/i);
  });
});

describe("voiceAckEmoji + voiceText", () => {
  it("returns a payload for every pipeline state", () => {
    for (const state of VOICE_STATES) {
      const payload = voiceAckEmoji(state);
      expect(payload.char.length).toBeGreaterThan(0);
      expect(payload.labelEn.length).toBeGreaterThan(0);
      expect(payload.labelSw.length).toBeGreaterThan(0);
    }
  });

  it("strips emoji from text destined for TTS", () => {
    expect(voiceText("Hello 🌱 there 🎉!")).toBe("Hello there !");
    expect(voiceText("✅ done")).toBe("done");
  });
});

describe("prefixedSubject", () => {
  it("prepends the kind-appropriate emoji", () => {
    const out = prefixedSubject({
      kind: "loan_approved",
      baseSubject: "Your loan is approved",
    });
    expect(out.subject.startsWith("🎉")).toBe(true);
  });

  it("supports every notification kind", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const out = prefixedSubject({ kind, baseSubject: "Hello" });
      expect(out.subject.length).toBeGreaterThan("Hello".length);
    }
  });

  it("skipIfPrefixed avoids double-emoji", () => {
    const out = prefixedSubject({
      kind: "loan_approved",
      baseSubject: "🌟 Already prefixed",
      skipIfPrefixed: true,
    });
    expect(out.subject).toBe("🌟 Already prefixed");
  });
});

describe("applicationJourney", () => {
  it("maps statuses to the seed-sprout-tree-care quartet", () => {
    expect(applicationJourneyState("draft")).toBe("seed");
    expect(applicationJourneyState("approved")).toBe("thriving");
    expect(applicationJourneyState("rejected")).toBe("with_care");
    expect(applicationJourneyState("submitted")).toBe("growing");
  });

  it("rail returns 4 distinct payloads in canonical order", () => {
    const rail = applicationJourneyRail();
    expect(rail.length).toBe(4);
    expect(rail[0]?.char).toBe("🌱");
    expect(rail[2]?.char).toBe("🌳");
  });

  it("has bilingual tooltips", () => {
    const p = applicationJourneyEmoji("growing");
    expect(p.tooltipEn.length).toBeGreaterThan(0);
    expect(p.tooltipSw.length).toBeGreaterThan(0);
  });
});

describe("complianceLight", () => {
  it("buckets risk scores into clear/watch/blocked", () => {
    expect(riskScoreToLevel(0.0)).toBe("clear");
    expect(riskScoreToLevel(0.5)).toBe("watch");
    expect(riskScoreToLevel(0.85)).toBe("blocked");
  });

  it("clamps NaN to watch", () => {
    expect(riskScoreToLevel(Number.NaN)).toBe("watch");
  });

  it("composes a header string", () => {
    expect(complianceHeader(0.1)).toMatch(/^🟢/);
    expect(complianceHeader(0.9)).toMatch(/^🔴/);
  });

  it("payload exposes bilingual labels", () => {
    const p = complianceLight("watch");
    expect(p.labelEn).toBe("Watch");
    expect(p.labelSw).toBe("Tahadhari");
  });
});

describe("officerFileTags", () => {
  it("provides exactly 4 tags", () => {
    expect(OFFICER_TAGS.length).toBe(4);
  });

  it("resolves a tag by id", () => {
    expect(officerTag("verified").emoji).toBe("check");
  });

  it("aria-label includes both the tag name and emoji name", () => {
    const label = officerTagAriaLabel("risk", "en");
    expect(label).toMatch(/Risk/);
    expect(label).toMatch(/needs attention/i);
  });
});
