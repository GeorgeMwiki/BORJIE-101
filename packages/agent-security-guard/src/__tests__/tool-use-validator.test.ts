/**
 * Tests for the tool-use sandbox validator (LLM06).
 *
 * Verifies:
 *   - authority-tier escalation rejection
 *   - schema-violation rejection (strict zod)
 *   - missing-confirmation required for destructive T2
 *   - recursion / fan-out limits
 *   - unknown-tool rejection
 *   - allow path for in-scope, well-formed call
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createInMemoryToolRegistry,
  createToolUseValidator,
  type ToolDefinition,
} from '../index.js';

const TOOLS: ReadonlyArray<ToolDefinition> = Object.freeze([
  Object.freeze({
    name: 'read_user_profile',
    description: 'Read the caller user profile',
    requiredTier: 'T0' as const,
    argsSchema: z.object({ userId: z.string().min(1) }),
    requiresConfirmation: false,
  }),
  Object.freeze({
    name: 'create_task',
    description: 'Create a task in tenant',
    requiredTier: 'T1' as const,
    argsSchema: z.object({
      title: z.string().min(1),
      assigneeId: z.string().min(1),
    }),
    requiresConfirmation: false,
  }),
  Object.freeze({
    name: 'transfer_funds',
    description: 'Transfer money — T2 destructive',
    requiredTier: 'T2' as const,
    argsSchema: z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      amountCents: z.number().int().positive(),
    }),
    requiresConfirmation: true,
  }),
]);

const registry = createInMemoryToolRegistry(TOOLS);
const validator = createToolUseValidator({ registry });

describe('ToolUseValidator (LLM06)', () => {
  it('allows T0 call from T0 caller with valid args', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'read_user_profile',
      args: { userId: 'u-1' },
      callerTier: 'T0',
      confirmed: false,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('allow');
    expect(d.violation).toBeNull();
  });

  it('rejects authority escalation (T0 calling T2 tool)', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'transfer_funds',
      args: { from: 'a', to: 'b', amountCents: 100 },
      callerTier: 'T0',
      confirmed: true,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('authority_escalation');
  });

  it('requires confirmation for T2 destructive tool', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'transfer_funds',
      args: { from: 'a', to: 'b', amountCents: 100 },
      callerTier: 'T2',
      confirmed: false,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('require-confirmation');
    expect(d.violation?.violationKind).toBe('missing_confirmation');
  });

  it('allows T2 destructive when confirmed=true', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'transfer_funds',
      args: { from: 'a', to: 'b', amountCents: 100 },
      callerTier: 'T2',
      confirmed: true,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('allow');
  });

  it('rejects schema violation (missing required arg)', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'create_task',
      args: { title: '' }, // assigneeId missing AND title empty
      callerTier: 'T1',
      confirmed: false,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('schema_violation');
  });

  it('rejects unknown extra args (strict mode)', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'read_user_profile',
      args: { userId: 'u-1', extraField: 'oops' },
      callerTier: 'T0',
      confirmed: false,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('schema_violation');
  });

  it('rejects unknown tool', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'nonexistent_tool',
      args: {},
      callerTier: 'T2',
      confirmed: true,
      callDepth: 1,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('unknown_tool');
  });

  it('rejects recursion depth > max', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'read_user_profile',
      args: { userId: 'u-1' },
      callerTier: 'T0',
      confirmed: false,
      callDepth: 99,
      siblingsAtThisDepth: 1,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('recursion_limit');
  });

  it('rejects fan-out width > max', () => {
    const d = validator.validate({
      tenantId: 't1',
      agentKind: 'mr-mwikila',
      toolName: 'read_user_profile',
      args: { userId: 'u-1' },
      callerTier: 'T0',
      confirmed: false,
      callDepth: 1,
      siblingsAtThisDepth: 99,
    });
    expect(d.decision).toBe('reject');
    expect(d.violation?.violationKind).toBe('recursion_limit');
  });
});
