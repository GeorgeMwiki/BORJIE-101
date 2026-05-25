/**
 * Tests for `decomposePlan`.
 *
 *   1. Sensor returns valid 3-step JSON → array of 3 decomposed steps
 *   2. Sensor returns malformed JSON → empty array
 *   3. Sensor returns schema-mismatched JSON (missing `description`) → []
 *   4. Sensor throws → empty array
 */
import { describe, it, expect } from 'vitest';
import { decomposePlan } from '../goals/plan-decomposer.js';
import type { Sensor, SensorCallResult } from '../../kernel-types.js';

function sensorReturning(text: string): Sensor {
  return {
    id: 'plan-stub',
    modelId: 'plan-stub',
    priority: 1,
    capabilities: ['fast'],
    async call(): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 0,
        modelId: 'plan-stub',
        sensorId: 'plan-stub',
      };
    },
  };
}

function throwingSensor(): Sensor {
  return {
    id: 'plan-throw',
    modelId: 'plan-throw',
    priority: 1,
    capabilities: ['fast'],
    async call(): Promise<SensorCallResult> {
      throw new Error('plan failure');
    },
  };
}

describe('decomposePlan', () => {
  it('parses a valid 3-step plan', async () => {
    const sensor = sensorReturning(
      JSON.stringify([
        { description: 'a', toolName: null, toolPayload: null },
        {
          description: 'b',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
        },
        { description: 'c', toolName: null, toolPayload: null },
      ]),
    );
    const out = await decomposePlan(
      {
        objective: 'resolve arrears',
        availableTools: [
          {
            name: 'rent.send-reminder',
            description: 'Send reminder',
            inputSchema: {},
          },
        ],
      },
      { sensor },
    );
    expect(out).toHaveLength(3);
    expect(out[1]?.toolName).toBe('rent.send-reminder');
  });

  it('returns empty array on malformed JSON', async () => {
    const sensor = sensorReturning('not json {');
    const out = await decomposePlan(
      { objective: 'x', availableTools: [] },
      { sensor },
    );
    expect(out).toEqual([]);
  });

  it('returns empty array when an item is missing `description`', async () => {
    const sensor = sensorReturning(
      JSON.stringify([
        { toolName: null, toolPayload: null },
      ]),
    );
    const out = await decomposePlan(
      { objective: 'x', availableTools: [] },
      { sensor },
    );
    expect(out).toEqual([]);
  });

  it('returns empty array when the sensor throws', async () => {
    const out = await decomposePlan(
      { objective: 'x', availableTools: [] },
      { sensor: throwingSensor() },
    );
    expect(out).toEqual([]);
  });
});
