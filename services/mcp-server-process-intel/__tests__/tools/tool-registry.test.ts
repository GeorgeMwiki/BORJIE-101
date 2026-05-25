import { describe, it, expect } from 'vitest';
import {
  PROCESS_INTEL_TOOLS,
  findProcessIntelTool,
} from '../../src/tools/index.js';

const EXPECTED_TOOL_NAMES = [
  'process_intel.get_processes',
  'process_intel.get_bottleneck_analysis',
  'process_intel.get_variants_with_metrics',
  'process_intel.get_correlation',
  'process_intel.get_conformance',
  'process_intel.get_loop_analysis',
  'process_intel.get_handoff_matrix',
  'process_intel.get_cycle_time_distribution',
  'process_intel.get_drift_alerts',
];

describe('PROCESS_INTEL_TOOLS', () => {
  it('exposes exactly the 9-tool MS-PA-compatible grammar', () => {
    expect(PROCESS_INTEL_TOOLS).toHaveLength(9);
    const names = PROCESS_INTEL_TOOLS.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('every tool has tenantId in required inputs (multi-tenant isolation)', () => {
    for (const tool of PROCESS_INTEL_TOOLS) {
      expect(tool.inputSchema.required).toContain('tenantId');
    }
  });

  it('every tool ships an input + output schema with object type', () => {
    for (const tool of PROCESS_INTEL_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('findProcessIntelTool resolves by name, returns undefined otherwise', () => {
    expect(findProcessIntelTool('process_intel.get_processes')).toBeDefined();
    expect(findProcessIntelTool('process_intel.nope')).toBeUndefined();
  });
});
