import { describe, expect, it } from "vitest";
import {
  buildWelcomeMessage,
  pickTopActions,
  buildImaginationLanes,
} from "../welcome-experience";

describe("welcome-experience", () => {
  it("greets the user by name and orgType in English by default", () => {
    const msg = buildWelcomeMessage({
      displayName: "Asha",
      orgType: "msme",
      region: "Arusha",
      sector: "tailoring",
      language: "en",
    });
    expect(msg.greeting).toMatch(/Welcome, Asha/);
    expect(msg.greeting).toMatch(/Arusha/);
    expect(msg.greeting).toMatch(/tailoring/);
  });

  it("greets in Swahili when language is sw", () => {
    const msg = buildWelcomeMessage({
      displayName: "Asha",
      orgType: "msme",
      language: "sw",
    });
    expect(msg.greeting).toMatch(/Karibu, Asha/);
    expect(msg.missionAlignment).toMatch(/Niko hapa/);
  });

  it("ships exactly 3 top actions", () => {
    const msg = buildWelcomeMessage({
      displayName: "Asha",
      orgType: "msme",
      language: "en",
    });
    expect(msg.topActions).toHaveLength(3);
  });

  it("picks VICOBA-specific actions for vicoba org", () => {
    const actions = pickTopActions({
      displayName: "Group",
      orgType: "vicoba",
      language: "en",
    });
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("vicoba-meeting");
  });

  it("picks bank-specific actions for bank org", () => {
    const actions = pickTopActions({
      displayName: "Bank",
      orgType: "bank",
      language: "en",
    });
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("officer-dashboard");
  });

  it("includes the 'build credit history not just sell loan' mission line", () => {
    const msg = buildWelcomeMessage({
      displayName: "x",
      orgType: "msme",
      language: "en",
    });
    expect(msg.missionAlignment).toMatch(/build credit history/i);
    expect(msg.missionAlignment).toMatch(/not just sell you a loan/i);
  });

  it("buildImaginationLanes returns 3 lanes spanning best/central/worst", () => {
    const lanes = buildImaginationLanes({
      displayName: "x",
      orgType: "msme",
      language: "en",
    });
    expect(lanes.map((l) => l.lane)).toEqual(["best", "central", "worst"]);
  });
});
