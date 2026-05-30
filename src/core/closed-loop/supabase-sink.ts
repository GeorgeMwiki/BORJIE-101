/**
 * Closed-Loop Process Layer — Supabase sink.
 *
 * Production wiring that writes tick rows + adjustments + per-loop
 * rolling state to the `closed_loops` / `closed_loop_ticks` /
 * `closed_loop_adjustments` tables. All writes use the service-role
 * client; the runtime always calls these with PII-stripped payloads
 * and tier-policy-asserted shapes.
 *
 * @module core/closed-loop/supabase-sink
 */

import type {
  ClosedLoopAdjustmentRow,
  ClosedLoopSink,
  ClosedLoopStateRow,
  ClosedLoopTickRow,
} from "./runtime";

/** Loose Supabase shape matching the rest of the codebase. */
export interface ClosedLoopSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    upsert(rows: unknown, opts?: Record<string, unknown>): any;
  };
}

export function createSupabaseClosedLoopSink(
  supabase: ClosedLoopSupabaseLike,
): ClosedLoopSink {
  return {
    async insertTick(row: ClosedLoopTickRow): Promise<void> {
      try {
        const { error } = await supabase.from("closed_loop_ticks").insert(row);
        if (error) {
          console.error("[closed-loop/sink] insertTick error:", error);
        }
      } catch (err) {
        console.error("[closed-loop/sink] insertTick exception:", err);
      }
    },

    async insertAdjustments(
      rows: ReadonlyArray<ClosedLoopAdjustmentRow>,
    ): Promise<void> {
      if (rows.length === 0) return;
      try {
        const { error } = await supabase
          .from("closed_loop_adjustments")
          .insert([...rows]);
        if (error) {
          console.error("[closed-loop/sink] insertAdjustments error:", error);
        }
      } catch (err) {
        console.error("[closed-loop/sink] insertAdjustments exception:", err);
      }
    },

    async upsertState(row: ClosedLoopStateRow): Promise<void> {
      try {
        const { error } = await supabase
          .from("closed_loops")
          .upsert(row, { onConflict: "loop_id,org_id" });
        if (error) {
          console.error("[closed-loop/sink] upsertState error:", error);
        }
      } catch (err) {
        console.error("[closed-loop/sink] upsertState exception:", err);
      }
    },
  };
}
