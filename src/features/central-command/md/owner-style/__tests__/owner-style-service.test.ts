import { describe, it, expect } from "vitest";
import { createOwnerStyleService } from "../owner-style-service";
import { createInMemoryProfileStore } from "../style-persistence";

const owner = { tenantId: "t-1", ownerUserId: "u-1" };
const NOW = () => "2026-05-17T10:00:00.000Z";

describe("owner-style-service", () => {
  it("getProfile returns default for unknown owner", async () => {
    const svc = createOwnerStyleService({ now: NOW });
    const p = await svc.getProfile(owner);
    expect(p.sampleSize).toBe(0);
    expect(p.ownerUserId).toBe(owner.ownerUserId);
  });

  it("updateFromTurn persists and increments sample size", async () => {
    const store = createInMemoryProfileStore();
    const svc = createOwnerStyleService({ store, now: NOW });
    const after = await svc.updateFromTurn({
      owner,
      turn: { text: "just do it", timestamp: "2026-05-17T09:00:00.000Z" },
    });
    expect(after.sampleSize).toBe(1);
    expect(after.decisionStyle.value).toBe("directive");

    const reload = await svc.getProfile(owner);
    expect(reload.sampleSize).toBe(1);
  });

  it("adaptPrompt and styleOutput use the persisted profile", async () => {
    const store = createInMemoryProfileStore();
    const svc = createOwnerStyleService({ store, now: NOW });
    for (let i = 0; i < 6; i++) {
      await svc.updateFromTurn({
        owner,
        turn: { text: "ok", timestamp: "2026-05-17T09:00:00.000Z" },
      });
    }
    const adapted = await svc.adaptPrompt({
      owner,
      prompt: { system: "MD here.", user: "advice?" },
    });
    expect(adapted.styleDirective).toContain("terse");

    const styled = await svc.styleOutput({
      owner,
      response:
        "Cashflow is tight. We expect recovery in week three. Pause one hire. Review Friday.",
    });
    expect(styled.transformations).toContain("compress_to_terse");
  });

  it("applyFeedback writes through to store", async () => {
    const store = createInMemoryProfileStore();
    const svc = createOwnerStyleService({ store, now: NOW });
    await svc.applyFeedback({ owner, signal: { kind: "use_swahili" } });
    const reload = await svc.getProfile(owner);
    expect(reload.languagePreference.value).toBe("swahili_leaning_bilingual");
  });

  it("applyFeedbackText with unrecognised text leaves profile unchanged", async () => {
    const svc = createOwnerStyleService({ now: NOW });
    const before = await svc.getProfile(owner);
    const after = await svc.applyFeedbackText({
      owner,
      text: "irrelevant chatter",
    });
    expect(after.sampleSize).toBe(before.sampleSize);
  });

  it("bootstrap writes through to store", async () => {
    const store = createInMemoryProfileStore();
    const svc = createOwnerStyleService({ store, now: NOW });
    const after = await svc.bootstrap({
      owner,
      turns: [
        {
          text: "just do it — execute aggressively",
          timestamp: "2026-05-17T07:00:00.000Z",
        },
        { text: "go ahead", timestamp: "2026-05-17T07:05:00.000Z" },
        { text: "ok", timestamp: "2026-05-17T07:10:00.000Z" },
      ],
    });
    expect(after.decisionStyle.value).toBe("directive");
    const reload = await svc.getProfile(owner);
    expect(reload.decisionStyle.value).toBe("directive");
  });

  it("tier-scoped: different owner gets a different default profile", async () => {
    const svc = createOwnerStyleService({ now: NOW });
    const p1 = await svc.getProfile({ tenantId: "t1", ownerUserId: "a" });
    const p2 = await svc.getProfile({ tenantId: "t1", ownerUserId: "b" });
    expect(p1.ownerUserId).toBe("a");
    expect(p2.ownerUserId).toBe("b");
  });
});
