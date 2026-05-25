/**
 * Unit tests for createActionToolRegistry.
 */
import { describe, it, expect } from 'vitest';
import {
  createActionToolRegistry,
  RENT_SEND_REMINDER_TOOL,
  WORK_ORDER_CREATE_TOOL,
} from '../action-tools/index.js';

describe('createActionToolRegistry', () => {
  it('register() then get() returns the registered tool', () => {
    const reg = createActionToolRegistry();
    reg.register(RENT_SEND_REMINDER_TOOL);
    const got = reg.get('rent.send-reminder');
    expect(got).not.toBeNull();
    expect(got?.stakes).toBe('low');
  });

  it('get() returns null for an unknown tool name', () => {
    const reg = createActionToolRegistry();
    expect(reg.get('does.not.exist')).toBeNull();
  });

  it('list() enumerates every registered tool exactly once', () => {
    const reg = createActionToolRegistry();
    reg.register(RENT_SEND_REMINDER_TOOL);
    reg.register(WORK_ORDER_CREATE_TOOL);
    // Re-registering the same name overwrites — list size stays 2.
    reg.register(RENT_SEND_REMINDER_TOOL);
    const list = reg.list();
    expect(list).toHaveLength(2);
    const names = list.map((t) => t.name).sort();
    expect(names).toEqual(['rent.send-reminder', 'work-order.create']);
  });
});
