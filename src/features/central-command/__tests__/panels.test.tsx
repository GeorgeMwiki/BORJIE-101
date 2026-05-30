/**
 * Smoke tests for central-command panel components.
 *
 * We render each panel with a minimal placeholder snapshot and assert
 * a stable headline string lands in the DOM. This is sufficient for a
 * wiring smoke pass; deeper interaction tests can be added once the
 * backing subsystems are live.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import {
  ActiveActionsTable,
  BrainStateCard,
  DriftSignalsCard,
  OutcomesPanel,
  PendingApprovalsTable,
  RecentThoughtsList,
  SkillProposalsTable,
} from "../index";
import { buildPlaceholderSnapshot } from "../server-state";

const snapshot = buildPlaceholderSnapshot(new Date("2026-05-15T12:00:00Z"));

describe("central-command panels render without throwing", () => {
  it("BrainStateCard renders its header", () => {
    const { container } = render(
      <BrainStateCard snapshot={snapshot.brainState} />,
    );
    expect(container.textContent).toContain("Brain state");
  });

  it("OutcomesPanel renders its header", () => {
    const { container } = render(
      <OutcomesPanel outcomes={snapshot.outcomes} />,
    );
    expect(container.textContent).toContain("Outcomes");
  });

  it("PendingApprovalsTable renders its header", () => {
    const { container } = render(
      <PendingApprovalsTable approvals={snapshot.approvals} />,
    );
    expect(container.textContent).toContain("Pending approvals");
  });

  it("ActiveActionsTable renders its header", () => {
    const { container } = render(
      <ActiveActionsTable actions={snapshot.activeActions} />,
    );
    expect(container.textContent).toContain("Active autonomous actions");
  });

  it("SkillProposalsTable renders its header", () => {
    const { container } = render(
      <SkillProposalsTable proposals={snapshot.skillProposals} />,
    );
    expect(container.textContent).toContain("Skill proposals");
  });

  it("DriftSignalsCard renders its header", () => {
    const { container } = render(
      <DriftSignalsCard signals={snapshot.driftSignals} />,
    );
    expect(container.textContent).toContain("Drift signals");
  });

  it("RecentThoughtsList renders its header", () => {
    const { container } = render(
      <RecentThoughtsList thoughts={snapshot.recentThoughts} />,
    );
    expect(container.textContent).toContain("Recent thoughts");
  });
});
