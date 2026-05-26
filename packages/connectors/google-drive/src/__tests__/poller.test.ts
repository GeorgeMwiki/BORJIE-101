import { describe, it, expect } from 'vitest';
import { pollDriveChanges } from '../ingest/poller.js';
import type { ConnectorLogger } from '../types.js';
import type { DriveHttpClient } from '../client/http-client.js';
import { NATIVE_DOC_MIME } from '../types.js';

const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeClient(over: Partial<DriveHttpClient> = {}): DriveHttpClient {
  return {
    async getStartPageToken() {
      return { startPageToken: 'tok-0' };
    },
    async listChanges() {
      return {};
    },
    async getFile() {
      throw new Error('not used');
    },
    async exportText() {
      return '';
    },
    async listComments() {
      return {};
    },
    ...over,
  };
}

describe('pollDriveChanges', () => {
  it('returns the start page token on first sync with no existing cursor', async () => {
    const client = makeClient();
    const result = await pollDriveChanges(
      {
        tenantId: 'tenant_a',
        account: 'george@borjie.test',
        accessToken: 'tok',
        pageToken: null,
        maxItems: 100,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rows.length).toBe(0);
      expect(result.nextPageToken).toBe('tok-0');
    }
  });

  it('normalises non-removed changes and exports text for native gdocs', async () => {
    let counter = 0;
    const client = makeClient({
      async listChanges() {
        return {
          changes: [
            {
              fileId: 'f-1',
              time: '2026-05-25T08:00:00.000Z',
              file: {
                id: 'f-1',
                name: 'Geology plan.gdoc',
                mimeType: NATIVE_DOC_MIME,
                modifiedTime: '2026-05-25T08:00:00.000Z',
                owners: [{ emailAddress: 'george@borjie.test' }],
                parents: ['root'],
              },
            },
          ],
          newStartPageToken: 'tok-1',
        };
      },
      async exportText() {
        return 'extracted text body';
      },
    });
    const result = await pollDriveChanges(
      {
        tenantId: 'tenant_a',
        account: 'george@borjie.test',
        accessToken: 'tok',
        pageToken: 'tok-0',
        maxItems: 100,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => `uuid-${++counter}`,
      },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]!.extractedText).toBe('extracted text body');
      expect(result.nextPageToken).toBe('tok-1');
    }
  });

  it('skips removed changes', async () => {
    const client = makeClient({
      async listChanges() {
        return {
          changes: [{ fileId: 'gone', removed: true }],
          newStartPageToken: 'tok-2',
        };
      },
    });
    const result = await pollDriveChanges(
      {
        tenantId: 'tenant_a',
        account: 'george@borjie.test',
        accessToken: 'tok',
        pageToken: 'tok-0',
        maxItems: 100,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.rows.length).toBe(0);
  });

  it('returns cursor-expired on listChanges 404', async () => {
    const client = makeClient({
      async listChanges() {
        const err = new Error('not found') as Error & { status?: number };
        err.status = 404;
        throw err;
      },
    });
    const result = await pollDriveChanges(
      {
        tenantId: 'tenant_a',
        account: 'george@borjie.test',
        accessToken: 'tok',
        pageToken: 'tok-stale',
        maxItems: 100,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.kind).toBe('cursor-expired');
  });
});
