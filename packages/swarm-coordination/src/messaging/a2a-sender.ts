/**
 * A2A sender — push messages from one agent to another (or to a
 * subject's audience, or broadcast).
 *
 * Wave 18HH. Validates inputs against the SQL CHECK constraints and
 * the routing-mode invariants (exactly one of {to_agent_id,
 * to_subject, broadcast} must apply).
 */

import { z } from 'zod';
import type {
  AgentMessage,
  AgentMessageKind,
  AgentMessagesRepository,
  AgentSubject,
} from '../types.js';

const KINDS: ReadonlyArray<AgentMessageKind> = [
  'inform',
  'request',
  'coordinate',
  'conflict',
  'handoff',
];

const sendInputSchema = z.object({
  tenantId: z.string().min(1),
  fromAgentId: z.string().min(1),
  messageKind: z.enum([
    'inform',
    'request',
    'coordinate',
    'conflict',
    'handoff',
  ]),
  payload: z.record(z.unknown()),
  toAgentId: z.string().min(1).optional(),
  toSubject: z
    .object({
      kind: z.string().min(1),
      id: z.string().min(1),
      summary: z.string().optional(),
    })
    .optional(),
});

export type ValidatedSendInput = z.infer<typeof sendInputSchema>;

export interface A2ASender {
  send(input: ValidatedSendInput): Promise<AgentMessage>;
}

export function createA2ASender(
  repository: AgentMessagesRepository,
): A2ASender {
  return {
    async send(rawInput) {
      const input = sendInputSchema.parse(rawInput);
      if (!KINDS.includes(input.messageKind)) {
        throw new Error(`Unknown A2A messageKind: ${input.messageKind}`);
      }
      const subjectArg: AgentSubject | undefined =
        input.toSubject === undefined
          ? undefined
          : {
              kind: input.toSubject.kind,
              id: input.toSubject.id,
              ...(input.toSubject.summary !== undefined
                ? { summary: input.toSubject.summary }
                : {}),
            };
      return repository.send({
        tenantId: input.tenantId,
        fromAgentId: input.fromAgentId,
        messageKind: input.messageKind,
        payload: input.payload,
        ...(input.toAgentId !== undefined
          ? { toAgentId: input.toAgentId }
          : {}),
        ...(subjectArg !== undefined ? { toSubject: subjectArg } : {}),
      });
    },
  };
}
