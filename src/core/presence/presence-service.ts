/**
 * Presence Awareness Service
 *
 * Real-time tracking of who is viewing each application using Supabase Presence.
 * Enables "Digital Twin" visibility - officers can see when borrowers are active
 * on their applications, and vice versa.
 *
 * Features:
 * - Track active viewers per application
 * - Cursor/selection sync for collaborative review
 * - Automatic cleanup on disconnect
 * - Activity status (idle, active, typing)
 */

import {
  createClient,
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";

// ============================================================================
// TYPES
// ============================================================================

export interface ViewerInfo {
  id: string;
  name: string;
  role: "officer" | "borrower" | "admin" | "manager";
  avatarUrl?: string;
  viewingSince: string;
  lastActive: string;
  status: "active" | "idle" | "typing";
  currentSection?: string;
}

export interface PresenceState {
  applicationId: string;
  viewers: ViewerInfo[];
  lastSync: string;
}

export interface PresenceUpdate {
  type: "JOIN" | "LEAVE" | "UPDATE";
  viewer: ViewerInfo;
  applicationId: string;
  timestamp: string;
}

export interface PresenceConfig {
  heartbeatInterval?: number;
  idleTimeout?: number;
  cleanupInterval?: number;
}

type PresenceCallback = (state: PresenceState) => void;
type UpdateCallback = (update: PresenceUpdate) => void;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_HEARTBEAT_INTERVAL = 30000; // 30 seconds
const DEFAULT_IDLE_TIMEOUT = 120000; // 2 minutes
const DEFAULT_CLEANUP_INTERVAL = 60000; // 1 minute

// ============================================================================
// PRESENCE SERVICE
// ============================================================================

export class PresenceService {
  private supabase: SupabaseClient;
  private channels: Map<string, RealtimeChannel> = new Map();
  private localState: Map<string, PresenceState> = new Map();
  private stateCallbacks: Map<string, Set<PresenceCallback>> = new Map();
  private updateCallbacks: Map<string, Set<UpdateCallback>> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private activityTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private config: Required<PresenceConfig>;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    config?: PresenceConfig,
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    this.config = {
      heartbeatInterval:
        config?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      idleTimeout: config?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
      cleanupInterval: config?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Join an application's presence channel
   */
  async joinApplication(
    applicationId: string,
    viewer: Omit<ViewerInfo, "viewingSince" | "lastActive" | "status">,
  ): Promise<void> {
    // Create or get channel
    let channel = this.channels.get(applicationId);
    if (!channel) {
      channel = this.supabase.channel(`presence:application:${applicationId}`);
      this.channels.set(applicationId, channel);
    }

    // Set up presence handlers
    channel
      .on("presence", { event: "sync" }, () => {
        this.handlePresenceSync(applicationId, channel!);
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        this.handlePresenceJoin(applicationId, key, newPresences);
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        this.handlePresenceLeave(applicationId, key, leftPresences);
      });

    // Subscribe to channel
    await channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // Track our presence
        const now = new Date().toISOString();
        const fullViewer: ViewerInfo = {
          ...viewer,
          viewingSince: now,
          lastActive: now,
          status: "active",
        };

        await channel!.track({
          user_id: viewer.id,
          user_name: viewer.name,
          user_role: viewer.role,
          avatar_url: viewer.avatarUrl,
          viewing_since: now,
          last_active: now,
          status: "active",
          current_section: viewer.currentSection,
        });

        // Start heartbeat
        this.startHeartbeat(applicationId, channel!, viewer.id);

        // Emit join event
        this.emitUpdate(applicationId, {
          type: "JOIN",
          viewer: fullViewer,
          applicationId,
          timestamp: now,
        });
      }
    });
  }

  /**
   * Leave an application's presence channel
   */
  async leaveApplication(
    applicationId: string,
    viewerId: string,
  ): Promise<void> {
    const channel = this.channels.get(applicationId);
    if (!channel) return;

    // Stop heartbeat
    this.stopHeartbeat(applicationId);

    // Untrack presence
    await channel.untrack();

    // Unsubscribe from channel
    await channel.unsubscribe();

    // Clean up
    this.channels.delete(applicationId);
    this.localState.delete(applicationId);
    this.stateCallbacks.delete(applicationId);
    this.updateCallbacks.delete(applicationId);

    // Emit leave event
    const viewer = this.localState
      .get(applicationId)
      ?.viewers.find((v) => v.id === viewerId);
    if (viewer) {
      this.emitUpdate(applicationId, {
        type: "LEAVE",
        viewer,
        applicationId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update viewer's current section
   */
  async updateSection(
    applicationId: string,
    viewerId: string,
    section: string,
  ): Promise<void> {
    const channel = this.channels.get(applicationId);
    if (!channel) return;

    const now = new Date().toISOString();
    await channel.track({
      current_section: section,
      last_active: now,
      status: "active",
    });

    // Reset activity timeout
    this.resetActivityTimeout(applicationId, viewerId, channel);
  }

  /**
   * Update viewer's activity status
   */
  async updateStatus(
    applicationId: string,
    viewerId: string,
    status: "active" | "idle" | "typing",
  ): Promise<void> {
    const channel = this.channels.get(applicationId);
    if (!channel) return;

    const now = new Date().toISOString();
    await channel.track({
      status,
      last_active: now,
    });

    if (status === "active") {
      this.resetActivityTimeout(applicationId, viewerId, channel);
    }
  }

  /**
   * Get current viewers for an application
   */
  getViewers(applicationId: string): ViewerInfo[] {
    return this.localState.get(applicationId)?.viewers ?? [];
  }

  /**
   * Check if a specific user is viewing an application
   */
  isUserViewing(applicationId: string, userId: string): boolean {
    const viewers = this.getViewers(applicationId);
    return viewers.some((v) => v.id === userId);
  }

  /**
   * Subscribe to presence state changes
   */
  onStateChange(applicationId: string, callback: PresenceCallback): () => void {
    let callbacks = this.stateCallbacks.get(applicationId);
    if (!callbacks) {
      callbacks = new Set();
      this.stateCallbacks.set(applicationId, callbacks);
    }
    callbacks.add(callback);

    // Immediately emit current state if available
    const state = this.localState.get(applicationId);
    if (state) {
      callback(state);
    }

    // Return unsubscribe function
    return () => {
      callbacks!.delete(callback);
    };
  }

  /**
   * Subscribe to presence updates (join/leave events)
   */
  onUpdate(applicationId: string, callback: UpdateCallback): () => void {
    let callbacks = this.updateCallbacks.get(applicationId);
    if (!callbacks) {
      callbacks = new Set();
      this.updateCallbacks.set(applicationId, callbacks);
    }
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks!.delete(callback);
    };
  }

  /**
   * Clean up all connections
   */
  async cleanup(): Promise<void> {
    // Stop all heartbeats
    for (const [applicationId] of this.heartbeatIntervals) {
      this.stopHeartbeat(applicationId);
    }

    // Unsubscribe from all channels
    // eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
    for (const [applicationId, channel] of this.channels) {
      await channel.untrack();
      await channel.unsubscribe();
    }

    // Clear all state
    this.channels.clear();
    this.localState.clear();
    this.stateCallbacks.clear();
    this.updateCallbacks.clear();
    this.activityTimeouts.clear();
  }

  // -------------------------------------------------------------------------
  // Private Methods - Presence Handlers
  // -------------------------------------------------------------------------

  private handlePresenceSync(
    applicationId: string,
    channel: RealtimeChannel,
  ): void {
    const presenceState = channel.presenceState();
    const viewers: ViewerInfo[] = [];

    for (const key in presenceState) {
      const presences = presenceState[key];
      for (const presence of presences) {
        viewers.push(this.presenceToViewer(presence));
      }
    }

    const state: PresenceState = {
      applicationId,
      viewers,
      lastSync: new Date().toISOString(),
    };

    this.localState.set(applicationId, state);
    this.emitStateChange(applicationId, state);
  }

  private handlePresenceJoin(
    applicationId: string,
    _key: string,
    newPresences: Array<Record<string, unknown>>,
  ): void {
    for (const presence of newPresences) {
      const viewer = this.presenceToViewer(presence);

      // Update local state
      const state = this.localState.get(applicationId);
      if (state) {
        const existingIndex = state.viewers.findIndex(
          (v) => v.id === viewer.id,
        );
        if (existingIndex >= 0) {
          state.viewers[existingIndex] = viewer;
        } else {
          state.viewers = [...state.viewers, viewer];
        }
        state.lastSync = new Date().toISOString();
        this.emitStateChange(applicationId, state);
      }

      // Emit update
      this.emitUpdate(applicationId, {
        type: "JOIN",
        viewer,
        applicationId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handlePresenceLeave(
    applicationId: string,
    _key: string,
    leftPresences: Array<Record<string, unknown>>,
  ): void {
    for (const presence of leftPresences) {
      const viewer = this.presenceToViewer(presence);

      // Update local state
      const state = this.localState.get(applicationId);
      if (state) {
        state.viewers = state.viewers.filter((v) => v.id !== viewer.id);
        state.lastSync = new Date().toISOString();
        this.emitStateChange(applicationId, state);
      }

      // Emit update
      this.emitUpdate(applicationId, {
        type: "LEAVE",
        viewer,
        applicationId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Heartbeat & Activity
  // -------------------------------------------------------------------------

  private startHeartbeat(
    applicationId: string,
    channel: RealtimeChannel,
    viewerId: string,
  ): void {
    // Clear existing heartbeat
    this.stopHeartbeat(applicationId);

    // Start new heartbeat
    const interval = setInterval(async () => {
      await channel.track({
        last_active: new Date().toISOString(),
      });
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(applicationId, interval);

    // Start activity timeout
    this.resetActivityTimeout(applicationId, viewerId, channel);
  }

  private stopHeartbeat(applicationId: string): void {
    const interval = this.heartbeatIntervals.get(applicationId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(applicationId);
    }

    const timeout = this.activityTimeouts.get(applicationId);
    if (timeout) {
      clearTimeout(timeout);
      this.activityTimeouts.delete(applicationId);
    }
  }

  private resetActivityTimeout(
    applicationId: string,
    _viewerId: string,
    channel: RealtimeChannel,
  ): void {
    // Clear existing timeout
    const existingTimeout = this.activityTimeouts.get(applicationId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(async () => {
      await channel.track({
        status: "idle",
      });
    }, this.config.idleTimeout);

    this.activityTimeouts.set(applicationId, timeout);
  }

  // -------------------------------------------------------------------------
  // Private Methods - Utilities
  // -------------------------------------------------------------------------

  private presenceToViewer(presence: Record<string, unknown>): ViewerInfo {
    return {
      id: String(presence.user_id ?? ""),
      name: String(presence.user_name ?? "Unknown"),
      role: (presence.user_role as ViewerInfo["role"]) ?? "officer",
      avatarUrl: presence.avatar_url as string | undefined,
      viewingSince: String(presence.viewing_since ?? new Date().toISOString()),
      lastActive: String(presence.last_active ?? new Date().toISOString()),
      status: (presence.status as ViewerInfo["status"]) ?? "active",
      currentSection: presence.current_section as string | undefined,
    };
  }

  private emitStateChange(applicationId: string, state: PresenceState): void {
    const callbacks = this.stateCallbacks.get(applicationId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(state);
        } catch (error) {
          console.error("[Borjie] Presence state callback error:", error);
        }
      }
    }
  }

  private emitUpdate(applicationId: string, update: PresenceUpdate): void {
    const callbacks = this.updateCallbacks.get(applicationId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(update);
        } catch (error) {
          console.error("[Borjie] Presence update callback error:", error);
        }
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

let presenceServiceInstance: PresenceService | null = null;

export function getPresenceService(
  supabaseUrl?: string,
  supabaseKey?: string,
  config?: PresenceConfig,
): PresenceService {
  if (!presenceServiceInstance) {
    const url = supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = supabaseKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

    if (!url || !key) {
      throw new Error("Supabase URL and key are required for presence service");
    }

    presenceServiceInstance = new PresenceService(url, key, config);
  }
  return presenceServiceInstance;
}

export function resetPresenceService(): void {
  if (presenceServiceInstance) {
    presenceServiceInstance.cleanup();
    presenceServiceInstance = null;
  }
}
