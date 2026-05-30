/**
 * Verifies the command-chat system prompt surfaces UI-sensing context
 * so the brain genuinely "knows" what the user is looking at.
 *
 * If a user says "this page" or "this form" the brain should already
 * have the route + focused field in its prompt — no extra tool call
 * needed.
 */

import { describe, it, expect } from "vitest";

import {
  buildCommandChatSystemSection,
  summariseRecentUiEvents,
} from "../tool-policy";
import type {
  FocusEvent,
  FormFieldEvent,
  RouteEvent,
  ScrollEvent,
  UiSenseEvent,
} from "@/core/brain/ui-sensing";

const TENANT = "11111111-1111-1111-1111-111111111111";
const PRINCIPAL = "22222222-2222-2222-2222-222222222222";

function routeEvent(pathname: string, ts: number): RouteEvent {
  return Object.freeze({
    kind: "route",
    pathname,
    search: "",
    dwellPreviousMs: 0,
    ts,
    tenantId: TENANT,
    principalId: PRINCIPAL,
  }) as RouteEvent;
}

function focusEvent(fieldName: string, ts: number): FocusEvent {
  return Object.freeze({
    kind: "focus",
    target: "input",
    fieldName,
    role: "textbox",
    ts,
    tenantId: TENANT,
    principalId: PRINCIPAL,
  }) as FocusEvent;
}

function formFieldEvent(
  field: string,
  action: FormFieldEvent["action"],
  ts: number,
): FormFieldEvent {
  return Object.freeze({
    kind: "form-field",
    form: "officer-create",
    field,
    action,
    ts,
    tenantId: TENANT,
    principalId: PRINCIPAL,
  }) as FormFieldEvent;
}

function scrollEvent(scrollDepth: number, ts: number): ScrollEvent {
  return Object.freeze({
    kind: "scroll",
    path: "/borjie-admin",
    scrollDepth,
    ts,
    tenantId: TENANT,
    principalId: PRINCIPAL,
  }) as ScrollEvent;
}

describe("summariseRecentUiEvents", () => {
  it("returns empty string for empty input", () => {
    expect(summariseRecentUiEvents([])).toBe("");
  });

  it("captures the most recent route from a sequence", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      routeEvent("/borjie-admin/users", 1000),
      routeEvent("/borjie-admin/officers", 2000),
      routeEvent("/borjie-admin/applications", 3000),
    ];
    const summary = summariseRecentUiEvents(events);
    expect(summary).toContain("Current route: `/borjie-admin/applications`");
    expect(summary).not.toContain("/borjie-admin/users");
  });

  it("surfaces the currently focused form field", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      routeEvent("/borjie-admin/users", 1000),
      focusEvent("email", 1500),
    ];
    const summary = summariseRecentUiEvents(events);
    expect(summary).toContain("Currently focused: `email`");
  });

  it("flags rapid-edit confusion patterns (>=3 changes on same field)", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      formFieldEvent("amount", "change", 1000),
      formFieldEvent("amount", "change", 1100),
      formFieldEvent("amount", "change", 1200),
    ];
    const summary = summariseRecentUiEvents(events);
    expect(summary).toContain("rapid edits on `amount`");
  });

  it("flags repeat-navigation patterns (same route visited >=3 times)", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      routeEvent("/borjie-admin/users", 1000),
      routeEvent("/borjie-admin/officers", 2000),
      routeEvent("/borjie-admin/users", 3000),
      routeEvent("/borjie-admin/officers", 4000),
      routeEvent("/borjie-admin/users", 5000),
    ];
    const summary = summariseRecentUiEvents(events);
    expect(summary).toContain("re-visited");
    expect(summary).toContain("/borjie-admin/users");
  });

  it("renders scroll depth as percentage", () => {
    const events: ReadonlyArray<UiSenseEvent> = [scrollEvent(0.42, 1000)];
    const summary = summariseRecentUiEvents(events);
    expect(summary).toMatch(/scroll depth: 42%/);
  });

  it("NEVER includes raw field values, only the most recent field name", () => {
    // The summariser deliberately surfaces only the LAST edited field
    // (most-recent activity) to keep the system prompt compact. The
    // critical invariant: no value-shape leakage in either direction.
    const events: ReadonlyArray<UiSenseEvent> = [
      formFieldEvent("email", "change", 1000),
      formFieldEvent("password", "change", 1100),
    ];
    const summary = summariseRecentUiEvents(events);
    // Field name surfaced (the most recent).
    expect(summary).toMatch(/`password`/);
    // NO value patterns anywhere.
    expect(summary).not.toMatch(/john@/);
    expect(summary).not.toMatch(/[A-Za-z0-9]{8,}@/); // email-shape
    expect(summary).not.toMatch(/secret|hunter2/i);
  });
});

describe("buildCommandChatSystemSection", () => {
  it("omits the UI-activity section when no events are provided", () => {
    const prompt = buildCommandChatSystemSection({
      userRole: "CARBONI_ADMIN",
      availableToolNames: ["list_users"],
    });
    expect(prompt).not.toContain("Recent UI activity");
    expect(prompt).toContain("Command Chat");
  });

  it("embeds the UI-activity section when events are provided", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      routeEvent("/borjie-admin/users", 1000),
      focusEvent("fullName", 2000),
    ];
    const prompt = buildCommandChatSystemSection({
      userRole: "CARBONI_ADMIN",
      availableToolNames: ["list_users"],
      recentUiEvents: events,
    });
    expect(prompt).toContain("## Recent UI activity");
    expect(prompt).toContain("Current route: `/borjie-admin/users`");
    expect(prompt).toContain("Currently focused: `fullName`");
  });

  it("preserves the tool list and rules even when UI events are present", () => {
    const events: ReadonlyArray<UiSenseEvent> = [
      routeEvent("/borjie-admin/users", 1000),
    ];
    const prompt = buildCommandChatSystemSection({
      userRole: "CARBONI_ADMIN",
      availableToolNames: ["list_users", "create_user"],
      recentUiEvents: events,
    });
    expect(prompt).toContain(
      "Tools currently available: list_users, create_user",
    );
    expect(prompt).toContain("four-eye approval");
    expect(prompt).toContain("## Recent UI activity");
  });
});
