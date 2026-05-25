import { describe, it, expect, beforeEach } from 'vitest';
import {
  DocumentChatService,
  StubAnthropicDocChatLlm,
  type IDocChatRepository,
  type IDocChatRetrieverPort,
  type DocChatSessionRecord,
  type DocChatMessageRecord,
  type RetrievedChunk,
  DocChatError,
} from '../services/document-chat.service.js';
import { EmbeddingService, StubEmbeddingModel } from '../services/embedding-service.js';

class MemChatRepo implements IDocChatRepository {
  sessions = new Map<string, DocChatSessionRecord>();
  messages = new Map<string, DocChatMessageRecord[]>();
  async createSession(rec: DocChatSessionRecord) { this.sessions.set(rec.id, rec); return rec; }
  async findSession(id: string, tenantId: string) {
    const s = this.sessions.get(id); return s && s.tenantId === tenantId ? s : null;
  }
  async addMessage(rec: DocChatMessageRecord) {
    const arr = this.messages.get(rec.sessionId) ?? [];
    arr.push(rec); this.messages.set(rec.sessionId, arr); return rec;
  }
  async listMessages(sessionId: string) { return this.messages.get(sessionId) ?? []; }
  async touchSession() {}
}

class StubRetriever implements IDocChatRetrieverPort {
  constructor(private readonly chunks: readonly RetrievedChunk[]) {}
  async retrieve() { return this.chunks; }
}

describe('DocumentChatService', () => {
  let svc: DocumentChatService;
  let repo: MemChatRepo;

  const withRetrieved = (chunks: readonly RetrievedChunk[]) => {
    repo = new MemChatRepo();
    svc = new DocumentChatService({
      repository: repo,
      embeddings: new EmbeddingService({ model: new StubEmbeddingModel(32) }),
      retriever: new StubRetriever(chunks),
      llm: new StubAnthropicDocChatLlm(),
    });
  };

  beforeEach(() => withRetrieved([]));

  it('starts a session with at least one document', async () => {
    const session = await svc.startSession({
      tenantId: 't1',
      scope: 'single_document',
      documentIds: ['doc_1'],
      createdBy: 'u1',
    });
    expect(session.documentIds).toEqual(['doc_1']);
  });

  it('refuses starting a session with zero documents', async () => {
    await expect(
      svc.startSession({
        tenantId: 't1',
        scope: 'single_document',
        documentIds: [],
        createdBy: 'u1',
      })
    ).rejects.toThrow();
  });

  it('ask enforces citations when retrieval returns context', async () => {
    withRetrieved([
      { id: 'c1', documentId: 'doc_1', chunkIndex: 0, text: 'Rent is KES 30,000', score: 0.9 },
    ]);
    const session = await svc.startSession({
      tenantId: 't1', scope: 'single_document', documentIds: ['doc_1'], createdBy: 'u1',
    });
    const { assistantMessage } = await svc.ask({
      tenantId: 't1', sessionId: session.id, question: 'What is the rent?', askedBy: 'u1',
    });
    expect(assistantMessage.citations.length).toBeGreaterThan(0);
    expect(assistantMessage.citations[0]!.documentId).toBe('doc_1');
  });

  it('ask refuses when no context retrieved AND LLM returns no citations', async () => {
    withRetrieved([]); // no retrieval
    const session = await svc.startSession({
      tenantId: 't1', scope: 'single_document', documentIds: ['doc_1'], createdBy: 'u1',
    });
    await expect(
      svc.ask({ tenantId: 't1', sessionId: session.id, question: 'Hello?', askedBy: 'u1' })
    ).rejects.toThrow(new RegExp(DocChatError.CITATION_REQUIRED));
  });

  it('postMessage only allowed in group_chat scope', async () => {
    const single = await svc.startSession({
      tenantId: 't1', scope: 'single_document', documentIds: ['doc_1'], createdBy: 'u1',
    });
    await expect(
      svc.postMessage({ tenantId: 't1', sessionId: single.id, authorUserId: 'u2', content: 'hi' })
    ).rejects.toThrow();

    const group = await svc.startSession({
      tenantId: 't1',
      scope: 'group_chat',
      documentIds: ['doc_1'],
      createdBy: 'u1',
      participants: ['u1', 'u2'],
    });
    const msg = await svc.postMessage({
      tenantId: 't1', sessionId: group.id, authorUserId: 'u2', content: 'hi',
    });
    expect(msg.content).toBe('hi');
  });
});
