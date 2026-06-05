import { describe, it, expect } from 'vitest';
import {
  MCP_SAFE_POLICY,
  MCP_SAFE_POLICY_VERSION,
  isToolMcpSafe,
  getMcpToolPolicy,
  filterMcpSafe,
  filterMcpSafeForTier,
} from '../mcp-safe-allowlist.js';

describe('MCP_SAFE_POLICY', () => {
  it('is frozen at module load (defense against runtime mutation)', () => {
    expect(Object.isFrozen(MCP_SAFE_POLICY)).toBe(true);
  });

  it('every entry has a non-empty citation', () => {
    for (const [name, policy] of Object.entries(MCP_SAFE_POLICY)) {
      expect(
        policy.citation.length,
        `${name} missing citation`,
      ).toBeGreaterThan(0);
      expect(
        policy.reason.length,
        `${name} missing reason`,
      ).toBeGreaterThan(0);
    }
  });

  it('exposes a non-empty policy version', () => {
    expect(MCP_SAFE_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('isToolMcpSafe', () => {
  it('returns true for whitelisted tools', () => {
    expect(isToolMcpSafe('site:list_for_counterparty')).toBe(true);
    expect(isToolMcpSafe('offtake:get_by_id')).toBe(true);
  });

  it('returns false for explicitly denied tools (with citation)', () => {
    expect(isToolMcpSafe('simulate_decision')).toBe(false);
    expect(isToolMcpSafe('read_brain_pulse')).toBe(false);
    expect(isToolMcpSafe('platform:set_killswitch')).toBe(false);
    expect(isToolMcpSafe('admin:impersonate_user')).toBe(false);
    expect(isToolMcpSafe('sovereign:adjust_pricing')).toBe(false);
  });

  it('returns false for unknown tools (deny-by-default)', () => {
    expect(isToolMcpSafe('not_a_registered_tool')).toBe(false);
    expect(isToolMcpSafe('site:exfiltrate_database')).toBe(false);
    expect(isToolMcpSafe('')).toBe(false);
  });
});

describe('getMcpToolPolicy', () => {
  it('returns the full policy record for a registered tool', () => {
    const p = getMcpToolPolicy('site:list_for_counterparty');
    expect(p).not.toBeNull();
    expect(p?.mcpSafe).toBe(true);
    expect(p?.citation).toMatch(/^mcp-safe\//);
  });

  it('returns null for unknown tool names', () => {
    expect(getMcpToolPolicy('definitely_not_a_tool')).toBeNull();
  });

  it('returns the policy (including the citation) for denied tools', () => {
    const p = getMcpToolPolicy('simulate_decision');
    expect(p?.mcpSafe).toBe(false);
    expect(p?.citation).toContain('H1');
  });
});

describe('filterMcpSafe', () => {
  it('keeps only mcpSafe=true entries', () => {
    const tools = [
      { name: 'site:list_for_counterparty' },
      { name: 'simulate_decision' },
      { name: 'sovereign:adjust_pricing' },
      { name: 'offtake:get_by_id' },
      { name: 'unknown_tool' },
    ];
    const filtered = filterMcpSafe(tools);
    expect(filtered.map((t) => t.name)).toEqual([
      'site:list_for_counterparty',
      'offtake:get_by_id',
    ]);
  });

  it('preserves additional properties on tool objects', () => {
    const tools = [
      { name: 'site:list_for_counterparty', description: 'list props' },
    ];
    const filtered = filterMcpSafe(tools);
    expect(filtered[0]).toEqual({ name: 'site:list_for_counterparty', description: 'list props' });
  });
});

describe('filterMcpSafeForTier', () => {
  const tools = [
    { name: 'site:list_for_counterparty' }, // no minTier
    { name: 'payment:list_for_offtake' }, // minTier: growth
    { name: 'maintenance:create_ticket' }, // minTier: growth
    { name: 'simulate_decision' }, // denied
  ];

  it('free tier sees only no-minTier tools', () => {
    const f = filterMcpSafeForTier(tools, 'free');
    expect(f.map((t) => t.name)).toEqual(['site:list_for_counterparty']);
  });

  it('growth tier sees growth-and-below tools', () => {
    const f = filterMcpSafeForTier(tools, 'growth');
    expect(f.map((t) => t.name).sort()).toEqual([
      'maintenance:create_ticket',
      'payment:list_for_offtake',
      'site:list_for_counterparty',
    ]);
  });

  it('enterprise sees everything mcpSafe', () => {
    const f = filterMcpSafeForTier(tools, 'enterprise');
    expect(f.map((t) => t.name).sort()).toEqual([
      'maintenance:create_ticket',
      'payment:list_for_offtake',
      'site:list_for_counterparty',
    ]);
  });

  it('never returns denied tools regardless of tier', () => {
    const f = filterMcpSafeForTier(tools, 'enterprise');
    expect(f.find((t) => t.name === 'simulate_decision')).toBeUndefined();
  });
});
