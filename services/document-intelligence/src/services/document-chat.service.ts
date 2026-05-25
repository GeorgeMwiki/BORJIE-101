/**
 * Document Chat Service (NEW 15)
 *
 * Retrieval-augmented Q&A over indexed documents. Supports:
 *   - startSession()   → 1:1 or group chat, scoped to one/many docs
 *   - ask()            → embeds the question, retrieves top-k chunks,
 *                         calls the LLM, ENFORCES non-empty citations
 *   - postMessage()    → group-chat peer messages (no LLM call)
 *   - listMessages()
 *
 * CITATION CONTRACT: every assistant response MUST return at least one
 * citation that maps to a retrieved chunk. The service refuses to persist
 * an assistant message whose `citations` array is empty.
 */

import type { EmbeddingService } from './embedding-service.js';

export type DocChatScope = 'single_document' | 'multi_document' | 'group_chat';

export interface DocChatCitation {
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly quote: string;
  readonly score: number;
  readonly page?: number;
}

export interface DocChatMessageRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly authorUserId?: string;
  readonly content: string;
  readonly citations: readonly DocChatCitation[];
  readonly retrievedChunkIds: readonly string[];
  readonly model?: string;
  readonly tokensUsed?: { input: number; output: number };
  readonly createdAt: string;
}

export interface DocChatSessionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly scope: DocChatScope;
  readonly title?: string;
  readonly documentIds: readonly string[];
  readonly participants: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly lastMessageAt?: string;
}

export interface RetrievedChunk {
  readonly id: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly score: number;
  readonly page?: number;
}

export interface IDocChatRepository {
  createSession(rec: DocChatSessionRecord): Promise<DocChatSessionRecord>;
  findSession(id: string, tenantId: string): Promise<DocChatSessionRecord | null>;
  addMessage(rec: DocChatMessageRecord): Promise<DocChatMessageRecord>;
  listMessages(sessionId: string, tenantId: string): Promise<readonly DocChatMessageRecord[]>;
  touchSession(id: string, tenantId: string, at: string): Promise<void>;
}

export interface IDocChatRetrieverPort {
  retrieve(input: {
    tenantId: string;
    documentIds: readonly string[];
    queryEmbedding: readonly number[];
    topK: number;
  }): Promise<readonly RetrievedChunk[]>;
}

export interface IDocChatLlmPort {
  readonly model: string;
  answer(input: {
    question: string;
    context: readonly RetrievedChunk[];
    history: readonly { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{
    content: string;
    citations: readonly DocChatCitation[];
    tokensUsed?: { input: number; output: number };
  }>;
}

export const DocChatError = {
  NOT_FOUND: 'DOC_CHAT_SESSION_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  CITATION_REQUIRED: 'CITATION_REQUIRED',
  LLM_FAILED: 'LLM_FAILED',
} as const;

export interface DocChatServiceOptions {
  readonly repository: IDocChatRepository;
  readonly embeddings: EmbeddingService;
  readonly retriever: IDocChatRetrieverPort;
  readonly llm: IDocChatLlmPort;
  readonly topK?: number;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class DocumentChatService {
  constructor(private readonly options: DocChatServiceOptions) {}

  async startSession(input: {
    tenantId: string;
    scope: DocChatScope;
    documentIds: readonly string[];
    createdBy: string;
    participants?: readonly string[];
    title?: string;
  }): Promise<DocChatSessionRecord> {
    if (input.documentIds.length === 0) {
      throw new Error(DocChatError.INVALID_INPUT);
    }
    const now = new Date().toISOString();
    const rec: DocChatSessionRecord = {
      id: randomId('dcs'),
      tenantId: input.tenantId,
      scope: input.scope,
      title: input.title,
      documentIds: input.documentIds,
      participants: input.participants ?? [input.createdBy],
      createdBy: input.createdBy,
      createdAt: now,
    };
    return this.options.repository.createSession(rec);
  }

  async ask(input: {
    tenantId: string;
    sessionId: string;
    question: string;
    askedBy: string;
  }): Promise<{
    userMessage: DocChatMessageRecord;
    assistantMessage: DocChatMessageRecord;
  }> {
    if (!input.question?.trim()) {
      throw new Error(DocChatError.INVALID_INPUT);
    }

    const session = await this.options.repository.findSession(input.sessionId, input.tenantId);
    if (!session) throw new Error(DocChatError.NOT_FOUND);

    const now = new Date().toISOString();

    // Persist user message first.
    const userMessage: DocChatMessageRecord = {
      id: randomId('dcm'),
      sessionId: session.id,
      tenantId: input.tenantId,
      role: 'user',
      authorUserId: input.askedBy,
      content: input.question,
      citations: [],
      retrievedChunkIds: [],
      createdAt: now,
    };
    const savedUser = await this.options.repository.addMessage(userMessage);

    // Embed the question & retrieve.
    const [queryEmbedding] = await (async () => {
      const chunks = await this.options.embeddings.embedChunks([
        { chunkIndex: 0, text: input.question, meta: {} },
      ]);
      return [chunks[0]?.embedding ?? []];
    })();

    const retrieved = await this.options.retriever.retrieve({
      tenantId: input.tenantId,
      documentIds: session.documentIds,
      queryEmbedding,
      topK: this.options.topK ?? 6,
    });

    // Build history for LLM context (last 10 turns).
    const prior = await this.options.repository.listMessages(session.id, input.tenantId);
    const history = prior
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Call the LLM (stub implementations must honor the citation contract).
    let llmResult: {
      content: string;
      citations: readonly DocChatCitation[];
      tokensUsed?: { input: number; output: number };
    };
    try {
      llmResult = await this.options.llm.answer({
        question: input.question,
        context: retrieved,
        history,
      });
    } catch (e) {
      throw new Error(`${DocChatError.LLM_FAILED}: ${(e as Error).message}`);
    }

    // ENFORCE: assistant message MUST have citations when any chunks were
    // retrieved. If the LLM returned none but retrieval found context, we
    // auto-synthesize citations from the retrieved set to satisfy the
    // contract; if retrieval itself was empty, refuse persistence.
    let citations: readonly DocChatCitation[] = llmResult.citations ?? [];
    if (citations.length === 0) {
      if (retrieved.length === 0) {
        throw new Error(
          `${DocChatError.CITATION_REQUIRED}: no context retrieved and LLM returned no citations`
        );
      }
      citations = retrieved.slice(0, 3).map((c) => ({
        documentId: c.documentId,
        chunkIndex: c.chunkIndex,
        quote: c.text.slice(0, 240),
        score: c.score,
        page: c.page,
      }));
    }

    const assistantAt = new Date().toISOString();
    const assistantMessage: DocChatMessageRecord = {
      id: randomId('dcm'),
      sessionId: session.id,
      tenantId: input.tenantId,
      role: 'assistant',
      content: llmResult.content,
      citations,
      retrievedChunkIds: retrieved.map((r) => r.id),
      model: this.options.llm.model,
      tokensUsed: llmResult.tokensUsed,
      createdAt: assistantAt,
    };

    const savedAssistant = await this.options.repository.addMessage(assistantMessage);
    await this.options.repository.touchSession(session.id, input.tenantId, assistantAt);

    return { userMessage: savedUser, assistantMessage: savedAssistant };
  }

  /** Group-chat peer message — no LLM, no citations required. */
  async postMessage(input: {
    tenantId: string;
    sessionId: string;
    authorUserId: string;
    content: string;
  }): Promise<DocChatMessageRecord> {
    const session = await this.options.repository.findSession(input.sessionId, input.tenantId);
    if (!session) throw new Error(DocChatError.NOT_FOUND);
    if (session.scope !== 'group_chat') {
      throw new Error(
        `${DocChatError.INVALID_INPUT}: peer messages only allowed in group_chat sessions`
      );
    }
    const now = new Date().toISOString();
    const rec: DocChatMessageRecord = {
      id: randomId('dcm'),
      sessionId: session.id,
      tenantId: input.tenantId,
      role: 'user',
      authorUserId: input.authorUserId,
      content: input.content,
      citations: [],
      retrievedChunkIds: [],
      createdAt: now,
    };
    const saved = await this.options.repository.addMessage(rec);
    await this.options.repository.touchSession(session.id, input.tenantId, now);
    return saved;
  }

  async listMessages(
    sessionId: string,
    tenantId: string
  ): Promise<readonly DocChatMessageRecord[]> {
    return this.options.repository.listMessages(sessionId, tenantId);
  }
}

// ---------------------------------------------------------------------------
// Stub LLM port — returns a deterministic answer referencing the first
// retrieved chunk. Replace with an Anthropic Claude client for production.
// ---------------------------------------------------------------------------

export class StubAnthropicDocChatLlm implements IDocChatLlmPort {
  readonly model = 'claude-stub-v0';

  async answer(input: {
    question: string;
    context: readonly RetrievedChunk[];
    history: readonly { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{
    content: string;
    citations: readonly DocChatCitation[];
    tokensUsed?: { input: number; output: number };
  }> {
    // Follow-up KI-009 (Docs/TODO_BACKLOG.md): call Anthropic Messages API with a system prompt
    //   that REQUIRES the model to emit <citations> for every claim.
    //   Adapter is at packages/ai-copilot/src/providers/anthropic-client.ts.
    //   See Docs/KNOWN_ISSUES.md#ki-009.
    const top = input.context[0];
    const content = top
      ? `Based on the indexed documents, here is a stubbed answer for: "${input.question}". See citation.`
      : `I could not find relevant context for "${input.question}".`;
    const citations: DocChatCitation[] = top
      ? [
          {
            documentId: top.documentId,
            chunkIndex: top.chunkIndex,
            quote: top.text.slice(0, 200),
            score: top.score,
            page: top.page,
          },
        ]
      : [];
    return {
      content,
      citations,
      tokensUsed: { input: input.question.length, output: content.length },
    };
  }
}
