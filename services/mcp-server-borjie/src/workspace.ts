/**
 * Workspace mirror — read-only snapshot of the owner's cockpit state.
 *
 * Per §12 of the SOTA primitive list: external agents should be able
 * to see what the owner has on screen RIGHT NOW so they can act in
 * context (e.g. don't navigate to a tab the owner is already on,
 * surface a reminder that the owner can see).
 *
 * The shape:
 *   - openTabs    — cockpit tab descriptors with their last-active stamp
 *   - recentReminders — five most-recent reminders the owner has seen
 *   - pinnedItems — items the owner has pinned in the cockpit
 *
 * The api-gateway adapter resolves this from the existing owner BFF
 * endpoints; this module owns the public shape so any future MCP
 * client can rely on it.
 */

import { z } from 'zod';

export const workspaceTabSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  lastActiveAt: z.string().datetime(),
});

export const workspaceReminderSchema = z.object({
  id: z.string(),
  at: z.string().datetime(),
  body: z.string(),
  status: z.enum(['pending', 'fired', 'cancelled']),
});

export const workspacePinSchema = z.object({
  id: z.string(),
  entityRef: z.string(),
  label: z.string(),
  pinnedAt: z.string().datetime(),
});

export const workspaceStateSchema = z.object({
  openTabs: z.array(workspaceTabSchema),
  recentReminders: z.array(workspaceReminderSchema).max(20),
  pinnedItems: z.array(workspacePinSchema),
  asOf: z.string().datetime(),
});

export type WorkspaceTab = z.infer<typeof workspaceTabSchema>;
export type WorkspaceReminder = z.infer<typeof workspaceReminderSchema>;
export type WorkspacePin = z.infer<typeof workspacePinSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export interface WorkspaceProvider {
  snapshot(input: {
    readonly tenantId: string;
    readonly ownerId: string;
  }): Promise<WorkspaceState>;
}

/** Test provider returning a deterministic empty snapshot. */
export function createEmptyWorkspaceProvider(): WorkspaceProvider {
  const provider: WorkspaceProvider = {
    async snapshot(_input: {
      readonly tenantId: string;
      readonly ownerId: string;
    }): Promise<WorkspaceState> {
      return {
        openTabs: [],
        recentReminders: [],
        pinnedItems: [],
        asOf: new Date(0).toISOString(),
      };
    },
  };
  return Object.freeze(provider);
}
