/**
 * MD core - contract type-checks.
 *
 * These tests exist to lock the structural typing of the subagent ports so
 * downstream agents implementing them know exactly what shape to satisfy.
 * If the type-checker compiles this file the contracts are intact.
 */

import { describe, it, expect } from "vitest";

import type {
  MdAutoPopulatePort,
  MdFollowUpPort,
  MdNbaPort,
  MdOwnerStylePort,
  MdSubagents,
  MdTimelinePort,
  MdEmployeesPort,
  MdPresenterPort,
} from "../contracts";
import { emptySnapshot } from "../business-state";

const nba: MdNbaPort = {
  async rankActions() {
    return [];
  },
  async getNextLowHangingFruit() {
    return null;
  },
  async getNextHighImpact() {
    return null;
  },
  async getDailyAgenda() {
    return [];
  },
};

const autoPopulate: MdAutoPopulatePort = {
  async populate() {
    return {
      ok: true,
      target: "x",
      fields: {},
      provenance: {},
      gaps: [],
    };
  },
};

const ownerStyle: MdOwnerStylePort = {
  async getProfile() {
    return null;
  },
  async refine(ownerId) {
    return {
      profile: {
        ownerId,
        posture: "deliberate",
        confidence: 0.5,
        tonePrefs: [],
        updatedAtMs: 0,
      },
      changeNote: "no change",
    };
  },
};

const followUp: MdFollowUpPort = {
  async schedule(req) {
    return {
      followUpId: "fu-1",
      orgId: req.orgId,
      ownerId: req.ownerId,
      title: req.title,
      dueAtMs: req.dueAtMs,
      sourceRef: req.sourceRef,
      subjectKind: req.subjectKind,
      subjectId: req.subjectId,
      createdAtMs: 0,
    };
  },
  async listDue() {
    return [];
  },
};

// Minimal no-op stubs for the 3 newer subagents — the contract test
// only verifies bundle assembly, not subagent behaviour.
const timeline: MdTimelinePort = {
  async build() {
    return [];
  },
};
const employees: MdEmployeesPort = {
  async read() {
    return [];
  },
};
const presenter: MdPresenterPort = {
  async process() {
    return null;
  },
};

describe("MdSubagents contracts", () => {
  it("composes a complete subagents bundle", () => {
    const bundle: MdSubagents = {
      nba,
      autoPopulate,
      ownerStyle,
      followUp,
      timeline,
      employees,
      presenter,
    };
    expect(bundle.nba).toBe(nba);
    expect(bundle.autoPopulate).toBe(autoPopulate);
    expect(bundle.ownerStyle).toBe(ownerStyle);
    expect(bundle.followUp).toBe(followUp);
    expect(bundle.timeline).toBe(timeline);
    expect(bundle.employees).toBe(employees);
    expect(bundle.presenter).toBe(presenter);
  });

  it("returns frozen empty snapshot from helper", () => {
    const s = emptySnapshot("org-x");
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.orgId).toBe("org-x");
  });
});
