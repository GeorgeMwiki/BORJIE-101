/**
 * @borjie/document-ai/chat-with-doc — public barrel.
 */

export { chatWithDoc } from './chat-with-doc.js';
export type { ChatWithDocConfig } from './chat-with-doc.js';

export { chatWithDocSet } from './chat-with-doc-set.js';
export type { ChatWithDocSetConfig } from './chat-with-doc-set.js';

export { chunkDocument } from './chunker.js';
export type { DocChunk, ChunkOptions } from './chunker.js';

export { retrieve } from './retriever.js';
export type { RetrievalResult, RetrieverConfig, RetrieveOptions } from './retriever.js';

export {
  parseAnswerWithCitations,
  formatCitationMarker,
} from './citations.js';
export type { ParsedAnswer } from './citations.js';
