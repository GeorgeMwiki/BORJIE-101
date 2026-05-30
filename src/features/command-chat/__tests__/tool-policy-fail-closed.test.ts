/**
 * Regression tests for the fail-closed `classifyTier` contract.
 *
 * Ported from Borjie PR #93 CRITICAL C1 (commit 2fb91068 —
 * "fix(aop-compiler): C1 permission-validator fail-closed").
 *
 * Invariant: when a tool's metadata does NOT prove it is read-only
 * (no requiredPermissions array, no requiresConfirmation flag) the
 * classifier MUST return a non-read tier so any downstream guard
 * (confirmation card, four-eye, audit) actually fires.
 *
 * Without this contract, a wiring that forgets to attach the
 * permission metadata to a destructive tool silently classifies it
 * as `read`, bypassing every gate.
 */

import { describe, it, expect } from "vitest";
import { classifyTier } from "../tool-policy";
import type { ToolDefinition } from "@/core/borjie-ai/types";

function makeTool(overrides: Partial<ToolDefinition>): ToolDefinition {
  // Minimal cast — we only exercise the fields classifyTier looks at.
  return {
    name: "test.tool",
    description: "test",
    parameters: {},
    ...overrides,
  } as ToolDefinition;
}

describe("classifyTier — fail-closed default (Borjie PR #93 C1)", () => {
  it("defaults to 'write' when both requiredPermissions and requiresConfirmation are absent", () => {
    const tool = makeTool({});
    expect(classifyTier(tool)).toBe("write");
  });

  it("defaults to 'write' when requiredPermissions is undefined and requiresConfirmation is undefined", () => {
    const tool = makeTool({
      requiredPermissions: undefined,
      requiresConfirmation: undefined,
    });
    expect(classifyTier(tool)).toBe("write");
  });

  it("returns 'read' ONLY when the tool EXPLICITLY declares empty perms AND requiresConfirmation: false", () => {
    const tool = makeTool({
      requiredPermissions: [],
      requiresConfirmation: false,
    });
    expect(classifyTier(tool)).toBe("read");
  });

  it("returns 'write' when requiresConfirmation: true (regardless of permissions)", () => {
    const tool = makeTool({
      requiredPermissions: [],
      requiresConfirmation: true,
    });
    expect(classifyTier(tool)).toBe("write");
  });

  it("returns 'write' on any *.write / *.execute / *.manage / *.delete permission", () => {
    for (const perm of [
      "loan.write",
      "officer.execute",
      "tenant.manage",
      "record.delete",
    ]) {
      const tool = makeTool({
        requiredPermissions: [perm],
        requiresConfirmation: false,
      });
      expect(classifyTier(tool)).toBe("write");
    }
  });

  it("returns 'sovereign' when the tool name is in the sovereign allowlist", () => {
    const tool = makeTool({ name: "platform.sovereign-revoke" });
    expect(classifyTier(tool, ["platform.sovereign-revoke"])).toBe("sovereign");
  });

  it("returns 'destructive' when the tool name is in the destructive allowlist", () => {
    const tool = makeTool({ name: "loan.disburse" });
    expect(classifyTier(tool, [], ["loan.disburse"])).toBe("destructive");
  });

  it("sovereign allowlist beats every metadata signal", () => {
    const tool = makeTool({
      name: "platform.kill-switch",
      requiredPermissions: [],
      requiresConfirmation: false,
    });
    expect(classifyTier(tool, ["platform.kill-switch"])).toBe("sovereign");
  });
});
