/**
 * `createRoute` definition for `/api/v1/mining/chat` (SSE entry).
 *
 * The 200 response is `text/event-stream`; frames decode to one variant
 * of the `ChatStreamFrame` discriminated union.
 */
import { createRoute } from '@hono/zod-openapi';

import { errorResponses } from './envelopes';
import { ChatTurnSchema, ChatStreamFrameSchema } from './chat-schemas';

export const chatTurnRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['chat'],
  summary: 'Submit a chat turn; receive an SSE stream of orchestrator frames.',
  description:
    'Response is `text/event-stream`. Each frame is one of: ' +
    '`turn.accepted`, `junior_call`, `message_chunk`, `done`, `error`. ' +
    'Use the `ChatStreamFrame` discriminated union to decode the wire format.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ChatTurnSchema } },
    },
  },
  responses: {
    200: {
      description:
        'SSE stream of orchestrator events. Each `data:` line is a JSON ' +
        'object whose shape is one variant of the ChatStreamFrame union.',
      content: {
        'text/event-stream': { schema: ChatStreamFrameSchema },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    500: errorResponses[500],
  },
});
