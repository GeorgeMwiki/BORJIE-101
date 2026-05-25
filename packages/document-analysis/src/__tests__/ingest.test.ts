import { describe, expect, it } from 'vitest';
import {
  ingestDocument,
  sanitiseFilenameForStorage,
  sha256Of,
} from '../ingest.js';
import {
  InMemoryDocumentRepository,
  InMemoryDocumentStorage,
  InMemoryEventBus,
} from '../in-memory-adapters.js';

function makeDeps(): {
  documents: InMemoryDocumentRepository;
  storage: InMemoryDocumentStorage;
  events: InMemoryEventBus;
} {
  return {
    documents: new InMemoryDocumentRepository(),
    storage: new InMemoryDocumentStorage(),
    events: new InMemoryEventBus(),
  };
}

describe('sha256Of', () => {
  it('produces hex sha256 for a string', () => {
    const h = sha256Of('hello');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
  it('matches Buffer and string of same content', () => {
    const a = sha256Of('payload');
    const b = sha256Of(Buffer.from('payload', 'utf8'));
    expect(a).toBe(b);
  });
});

describe('sanitiseFilenameForStorage', () => {
  it('replaces unsafe characters and neutralises leading dots', () => {
    // Path traversal must be defused: leading dot is prefixed with `_`
    // so the file cannot land as a dotfile in storage adapters.
    expect(sanitiseFilenameForStorage('../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitiseFilenameForStorage('résumé.pdf')).toBe('r_sum_.pdf');
  });
  it('avoids leading dot to prevent hidden files', () => {
    expect(sanitiseFilenameForStorage('.htaccess')).toMatch(/^_/);
  });
  it('caps length', () => {
    const long = 'a'.repeat(500);
    expect(sanitiseFilenameForStorage(long).length).toBeLessThanOrEqual(200);
  });
});

describe('ingestDocument', () => {
  it('persists a new document and emits ingested event', async () => {
    const deps = makeDeps();
    const result = await ingestDocument(
      {
        tenantId: 'tenant-a',
        filename: 'lease.txt',
        mimeType: 'text/plain',
        content: 'hello world',
      },
      deps,
    );
    expect(result.deduped).toBe(false);
    expect(result.document.tenantId).toBe('tenant-a');
    expect(result.document.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.document.sizeBytes).toBe(11);
    expect(deps.events.events).toHaveLength(1);
    expect(deps.events.events[0]?.stage).toBe('ingested');
  });

  it('dedupes a re-upload of the same content within the same tenant', async () => {
    const deps = makeDeps();
    const first = await ingestDocument(
      {
        tenantId: 'tenant-a',
        filename: 'lease.txt',
        mimeType: 'text/plain',
        content: 'duplicate payload',
      },
      deps,
    );
    const second = await ingestDocument(
      {
        tenantId: 'tenant-a',
        filename: 'lease-copy.txt',
        mimeType: 'text/plain',
        content: 'duplicate payload',
      },
      deps,
    );
    expect(second.deduped).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(deps.documents.snapshot()).toHaveLength(1);
  });

  it('keeps tenants isolated when the content is identical', async () => {
    const deps = makeDeps();
    const a = await ingestDocument(
      {
        tenantId: 'tenant-a',
        filename: 'doc.txt',
        mimeType: 'text/plain',
        content: 'shared content',
      },
      deps,
    );
    const b = await ingestDocument(
      {
        tenantId: 'tenant-b',
        filename: 'doc.txt',
        mimeType: 'text/plain',
        content: 'shared content',
      },
      deps,
    );
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(false);
    expect(a.document.id).not.toBe(b.document.id);
    expect(deps.documents.snapshot()).toHaveLength(2);
  });

  it('rejects invalid input (zod schema)', async () => {
    const deps = makeDeps();
    await expect(
      ingestDocument(
        {
          tenantId: '',
          filename: '',
          mimeType: '',
          content: 'x',
        },
        deps,
      ),
    ).rejects.toThrow();
  });
});
