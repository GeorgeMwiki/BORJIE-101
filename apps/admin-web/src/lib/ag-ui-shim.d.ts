/**
 * Module-augmentation shim for `@borjie/central-intelligence`.
 *
 * The central-intelligence package ships pre-built type declarations
 * (`dist/index.d.ts`), but the AG-UI streaming surface (Phase A) was
 * added after the last build. Until the package's dist is regenerated,
 * this shim declares the AG-UI exports the Central-Command portal
 * needs so `tsc --noEmit` resolves them. Vitest already resolves
 * through the source via the resolve.alias in vitest.config.ts.
 *
 * Remove this file once `pnpm --filter @borjie/central-intelligence
 * build` succeeds and emits the streaming exports.
 */

declare module '@borjie/central-intelligence' {
  export type JsonPatchOp = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

  export interface JsonPatch {
    readonly op: JsonPatchOp;
    readonly path: string;
    readonly value?: unknown;
    readonly from?: string;
  }

  export interface AgUiUsage {
    readonly promptTokens: number;
    readonly completionTokens: number;
  }

  export type AgUiEvent =
    | { readonly type: 'RUN_STARTED'; readonly threadId: string; readonly runId: string; readonly timestamp: number }
    | { readonly type: 'TEXT_MESSAGE_START'; readonly messageId: string; readonly role: 'assistant' }
    | { readonly type: 'TEXT_MESSAGE_CONTENT'; readonly messageId: string; readonly delta: string }
    | { readonly type: 'TEXT_MESSAGE_END'; readonly messageId: string }
    | { readonly type: 'TOOL_CALL_START'; readonly toolCallId: string; readonly toolName: string }
    | { readonly type: 'TOOL_CALL_ARGS'; readonly toolCallId: string; readonly delta: string }
    | { readonly type: 'TOOL_CALL_END'; readonly toolCallId: string }
    | { readonly type: 'TOOL_RESULT'; readonly toolCallId: string; readonly result: unknown; readonly uiPart?: unknown }
    | { readonly type: 'STATE_DELTA'; readonly patch: ReadonlyArray<JsonPatch> }
    | { readonly type: 'STATE_SNAPSHOT'; readonly state: unknown }
    | { readonly type: 'RUN_FINISHED'; readonly runId: string; readonly usage?: AgUiUsage }
    | { readonly type: 'RUN_ERROR'; readonly runId: string; readonly error: string };

  export type AgUiEventType = AgUiEvent['type'];
  export type AgUiTerminalEventType = 'RUN_FINISHED' | 'RUN_ERROR';

  export const AG_UI_EVENT_TYPES: ReadonlyArray<AgUiEventType>;
  export const AG_UI_TERMINAL_EVENT_TYPES: ReadonlyArray<AgUiTerminalEventType>;

  export function isAgUiEventType(value: unknown): value is AgUiEventType;
  export function isTerminalAgUiEvent(event: AgUiEvent): boolean;
  export function validateAgUiEvent(
    event: unknown,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}
