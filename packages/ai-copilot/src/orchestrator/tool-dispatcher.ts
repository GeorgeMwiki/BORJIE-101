/**
 * Tool Dispatcher
 *
 * Executes tool calls on behalf of personae. Every tool call is:
 *  - RBAC-checked against the human principal the persona is acting for
 *  - Logged to the governance service
 *  - Emitted to the Thread Store as tool_call + tool_result events
 *
 * The dispatcher itself owns no business logic; it delegates to registered
 * tool handlers (graph tools from @borjie/graph-sync, skills from the
 * skills module).
 */

import { v4 as uuid } from 'uuid';
import {
  AIActor,
  AITenantContext,
  AIResult,
  aiOk,
  aiErr,
} from '../types/core.types.js';
import { Persona } from '../personas/persona.js';
import { ThreadStore } from '../thread/thread-store.js';
import { VisibilityLabel } from '../thread/visibility.js';

export interface ToolHandler {
  /** Tool name, e.g. `skill.finance.draft_arrears_notice` or `get_unit_health`. */
  name: string;
  /** Human-readable description — surfaced to the LLM as tool definition. */
  description: string;
  /** JSON-schema for the tool's parameters. */
  parameters: Record<string, unknown>;
  /** Execute the tool. */
  execute(
    params: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  tenant: AITenantContext;
  actor: AIActor;
  persona: Persona;
  threadId: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  data?: unknown;
  evidenceSummary?: string;
  error?: string;
}

export interface DispatchError {
  code:
    | 'TOOL_NOT_FOUND'
    | 'TOOL_NOT_ALLOWED'
    | 'TOOL_EXECUTION_FAILED'
    | 'INVALID_PARAMS';
  message: string;
  retryable: boolean;
}

export class ToolDispatcher {
  private handlers = new Map<string, ToolHandler>();

  constructor(private readonly threads: ThreadStore) {}

  register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  list(): ToolHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get the definitions for all tools a given persona is permitted to call.
   * This is the list injected into the LLM prompt as function definitions.
   */
  getDefinitionsFor(persona: Persona): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    const allowed = new Set(persona.allowedTools);
    return this.list()
      .filter((h) => allowed.has(h.name))
      .map((h) => ({
        name: h.name,
        description: h.description,
        parameters: h.parameters,
      }));
  }

  /**
   * Dispatch a tool call. Enforces allow-list, logs to thread, returns result.
   */
  async dispatch(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
    visibility: VisibilityLabel
  ): Promise<AIResult<ToolExecutionResult, DispatchError>> {
    if (!context.persona.allowedTools.includes(toolName)) {
      await this.threads.append({
        id: uuid(),
        threadId: context.threadId,
        kind: 'system_note',
        noteKind: 'governance',
        createdAt: new Date().toISOString(),
        visibility: { ...visibility, scope: 'management' },
        actorId: context.persona.id,
        text: `denied tool call: ${context.persona.id} is not allowed to call ${toolName}`,
      });
      return aiErr<DispatchError>({
        code: 'TOOL_NOT_ALLOWED',
        message: `Persona ${context.persona.id} is not allowed to call ${toolName}`,
        retryable: false,
      });
    }

    const handler = this.handlers.get(toolName);
    if (!handler) {
      return aiErr<DispatchError>({
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${toolName}`,
        retryable: false,
      });
    }

    const callId = uuid();
    const startedAt = Date.now();

    await this.threads.append({
      id: callId,
      threadId: context.threadId,
      kind: 'tool_call',
      createdAt: new Date().toISOString(),
      visibility,
      actorId: context.persona.id,
      personaId: context.persona.id,
      toolName,
      params,
    });

    let result: ToolExecutionResult;
    try {
      result = await handler.execute(params, context);
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await this.threads.append({
      id: uuid(),
      threadId: context.threadId,
      kind: 'tool_result',
      createdAt: new Date().toISOString(),
      visibility,
      actorId: context.persona.id,
      personaId: context.persona.id,
      toolName,
      result: result.data ?? null,
      evidenceSummary: result.evidenceSummary,
      ok: result.ok,
      executionTimeMs: Date.now() - startedAt,
      parentEventId: callId,
    });

    if (!result.ok) {
      return aiErr<DispatchError>({
        code: 'TOOL_EXECUTION_FAILED',
        message: result.error ?? 'tool execution failed',
        retryable: true,
      });
    }

    return aiOk(result);
  }
}
