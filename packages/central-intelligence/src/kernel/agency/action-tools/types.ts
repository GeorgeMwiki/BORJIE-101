/**
 * Agency — typed write-tool definitions.
 *
 * The autonomous executor invokes tools by name. Each tool declares a
 * JSON Schema for its input, a stakes level (drives autonomy-policy +
 * four-eye gating), and an `invoke(input, ctx)` adapter. The registry
 * is in-process and populated at the composition root.
 */
export type ActionToolStakes = 'low' | 'medium' | 'high' | 'critical';

export interface ActionToolContext {
  readonly tenantId: string;
  readonly userId: string;
}

export type ActionToolResult<O = unknown> =
  | { readonly ok: true; readonly output: O }
  | { readonly ok: false; readonly message: string };

export interface ActionToolDef<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly stakes: ActionToolStakes;
  invoke(input: I, ctx: ActionToolContext): Promise<ActionToolResult<O>>;
}

export interface ActionToolRegistry {
  register<I, O>(tool: ActionToolDef<I, O>): void;
  list(): ReadonlyArray<ActionToolDef>;
  get(name: string): ActionToolDef | null;
}
