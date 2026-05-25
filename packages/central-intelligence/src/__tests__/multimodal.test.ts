/**
 * Multimodal (image) input — kernel + Anthropic-sensor adapter.
 *
 * Coverage:
 *   - The Anthropic sensor adapter sends a multipart `content` array
 *     when ThoughtAttachments are present, and a plain string when not.
 *   - The sensor router restricts eligibility to vision-capable sensors
 *     when the kernel asks for the `vision` capability.
 *   - The full kernel pipeline (composeSovereign) runs cleanly when an
 *     image attachment is supplied — provenance, drift, and policy
 *     gates all execute against the resulting decision.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  createAnthropicSensor,
  createSensorRouter,
  type AnthropicMessagesClient,
  type AnthropicRequestContentBlock,
  type AnthropicRequestMessage,
  type ScopeContext,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtAttachment,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'sovereign-admin',
};

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function makeImageAttachment(): ThoughtAttachment {
  return {
    kind: 'image',
    mediaType: 'image/png',
    data: TINY_PNG_BASE64,
    caption: 'damage.png',
  };
}

interface CapturedCall {
  messages: ReadonlyArray<AnthropicRequestMessage>;
}

function stubAnthropicClient(captured: CapturedCall[]): AnthropicMessagesClient {
  return {
    messages: {
      async create(args) {
        captured.push({ messages: args.messages });
        return {
          id: 'm_stub',
          model: args.model,
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'I see the image.' }],
        };
      },
    },
  };
}

describe('Anthropic sensor adapter — multimodal user content', () => {
  it('sends a plain-string user content when no attachments are present', async () => {
    const captured: CapturedCall[] = [];
    const client = stubAnthropicClient(captured);
    const sensor = createAnthropicSensor(client, {
      id: 'opus-vision',
      modelId: 'claude-opus-4-7',
      priority: 1,
      capabilities: ['vision', 'fast'],
    });

    await sensor.call({
      system: 'sys',
      userMessage: 'plain text turn',
      priorTurns: [],
      extendedThinking: false,
      stakes: 'low',
    });

    expect(captured.length).toBe(1);
    const userMsg = captured[0]!.messages[captured[0]!.messages.length - 1]!;
    expect(userMsg.role).toBe('user');
    expect(typeof userMsg.content).toBe('string');
    expect(userMsg.content).toBe('plain text turn');
  });

  it('sends a multipart array (images first, text last) when attachments are present', async () => {
    const captured: CapturedCall[] = [];
    const client = stubAnthropicClient(captured);
    const sensor = createAnthropicSensor(client, {
      id: 'opus-vision',
      modelId: 'claude-opus-4-7',
      priority: 1,
      capabilities: ['vision', 'fast'],
    });

    await sensor.call({
      system: 'sys',
      userMessage: 'review this lease scan',
      priorTurns: [],
      extendedThinking: false,
      stakes: 'low',
      attachments: [makeImageAttachment()],
    });

    expect(captured.length).toBe(1);
    const userMsg = captured[0]!.messages[captured[0]!.messages.length - 1]!;
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);

    const blocks = userMsg.content as ReadonlyArray<AnthropicRequestContentBlock>;
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.type).toBe('image');
    if (blocks[0]!.type === 'image') {
      expect(blocks[0]!.source.type).toBe('base64');
      expect(blocks[0]!.source.media_type).toBe('image/png');
      expect(blocks[0]!.source.data).toBe(TINY_PNG_BASE64);
    }
    expect(blocks[1]!.type).toBe('text');
    if (blocks[1]!.type === 'text') {
      expect(blocks[1]!.text).toBe('review this lease scan');
    }
  });
});

describe('Sensor router — vision capability gating', () => {
  it("only picks vision-capable sensors when 'vision' is required", async () => {
    const visionSensor: Sensor = {
      id: 'vision-only',
      modelId: 'vision-1',
      priority: 2,
      capabilities: ['vision', 'fast'],
      async call(_args: SensorCallArgs): Promise<SensorCallResult> {
        return {
          text: 'vision answer',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'vision-1',
          sensorId: 'vision-only',
        };
      },
    };
    const fastOnly: Sensor = {
      id: 'fast-only',
      modelId: 'fast-1',
      priority: 1, // higher priority (lower number) but lacks vision
      capabilities: ['fast'],
      async call(_args: SensorCallArgs): Promise<SensorCallResult> {
        return {
          text: 'should not be called',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'fast-1',
          sensorId: 'fast-only',
        };
      },
    };

    const router = createSensorRouter({ sensors: [fastOnly, visionSensor] });
    const result = await router.call(
      {
        system: 'sys',
        userMessage: 'caption this',
        priorTurns: [],
        extendedThinking: false,
        stakes: 'low',
      },
      ['vision'],
    );

    expect(result.sensorId).toBe('vision-only');
    expect(result.text).toBe('vision answer');
  });

  it('throws SensorFailoverError when no sensor satisfies the vision capability', async () => {
    const fastOnly: Sensor = {
      id: 'fast-only',
      modelId: 'fast-1',
      priority: 1,
      capabilities: ['fast'],
      async call(): Promise<SensorCallResult> {
        return {
          text: 'unreachable',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'fast-1',
          sensorId: 'fast-only',
        };
      },
    };
    const router = createSensorRouter({ sensors: [fastOnly] });
    await expect(
      router.call(
        {
          system: 'sys',
          userMessage: 'caption this',
          priorTurns: [],
          extendedThinking: false,
          stakes: 'low',
        },
        ['vision'],
      ),
    ).rejects.toThrow(/no sensor satisfies/);
  });
});

describe('Kernel.think — multimodal pipeline', () => {
  it('runs the full pipeline with an image attachment and records provenance', async () => {
    let receivedAttachments: ReadonlyArray<ThoughtAttachment> | undefined;
    let receivedSystem = '';
    const captureSensor: Sensor = {
      id: 'capture-vision',
      modelId: 'capture-vision-1',
      priority: 1,
      capabilities: ['vision', 'fast'],
      async call(args) {
        receivedSystem = args.system;
        receivedAttachments = args.attachments;
        return {
          text: 'I see the photo: looks like a damaged door frame.',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'capture-vision-1',
          sensorId: 'capture-vision',
        };
      },
    };

    const sov = composeSovereign({ extraSensors: [captureSensor] });

    const decision = await sov.kernel.think({
      threadId: 't_mm',
      userMessage: 'What is wrong in this photo?',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
      attachments: [makeImageAttachment()],
    });

    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(true);
    expect(receivedAttachments).toBeDefined();
    expect(receivedAttachments!.length).toBe(1);
    expect(receivedAttachments![0]!.kind).toBe('image');
    expect(receivedAttachments![0]!.mediaType).toBe('image/png');
    // System prompt is still rendered (locus / behavioural / verbosity).
    expect(receivedSystem.length).toBeGreaterThan(0);
    // Provenance was captured (the cache key changes per turn so we
    // also verify the producer didn't crash).
    expect(decision.provenance.thoughtId).toBeTruthy();
    expect(decision.provenance.sensorId).toBe('capture-vision');
  });

  it("does not pass attachments to the sensor when the request has none", async () => {
    let receivedAttachments: ReadonlyArray<ThoughtAttachment> | undefined = [];
    const captureSensor: Sensor = {
      id: 'capture-text',
      modelId: 'capture-text-1',
      priority: 1,
      capabilities: ['fast', 'vision'],
      async call(args) {
        receivedAttachments = args.attachments;
        return {
          text: 'text-only answer',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'capture-text-1',
          sensorId: 'capture-text',
        };
      },
    };

    const sov = composeSovereign({ extraSensors: [captureSensor] });
    await sov.kernel.think({
      threadId: 't_text',
      userMessage: 'plain text follow-up',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });

    expect(receivedAttachments).toBeUndefined();
  });
});
