import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRunCommand } from '../src/commands/agent.js';
import { saveProfile } from '../src/profiles.js';
import { createLogger } from '../src/logger.js';
import { agentRunFilePath } from '../src/paths.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'borjie-cli-agent-'));
  process.env['BORJIE_HOME'] = dir;
  process.env['BORJIE_CREDENTIALS_FILE'] = join(dir, 'credentials.json');
  saveProfile({
    version: 1,
    name: 'default',
    apiUrl: 'https://api.test',
    accessToken: 'tok',
    clientId: 'borjie-cli',
    scopes: [],
    issuedAt: new Date().toISOString(),
  });
});

afterEach(() => {
  delete process.env['BORJIE_HOME'];
  delete process.env['BORJIE_CREDENTIALS_FILE'];
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('agent run loop', () => {
  it('executes a low-risk tool then halts on done', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/api/v1/agent/plan')) {
        if (calls.filter((c) => c.endsWith('/plan')).length === 1) {
          return new Response(
            JSON.stringify({
              run_id: 'r1',
              next_step: {
                tool: 'drafts.ls',
                args: {},
                risk: 'low',
                rationale: 'list drafts',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ done: true, summary: 'all good' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const runner = vi.fn(async () => ({ ok: true }));
    const logger = createLogger({ json: true });
    await agentRunCommand({
      logger,
      task: 'list my drafts',
      maxSteps: 5,
      autoApprove: true,
      runId: 'r1',
      toolRunner: runner,
    });

    expect(runner).toHaveBeenCalledWith('drafts.ls', {});
    const trace = readFileSync(agentRunFilePath('r1'), 'utf8');
    expect(trace).toContain('drafts.ls');
    expect(trace).toContain('done');
  });

  it('bails gracefully when the server endpoint is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const logger = createLogger({ json: true });
    await agentRunCommand({
      logger,
      task: 'whatever',
      maxSteps: 2,
      autoApprove: true,
      runId: 'r2',
    });
    // No throw, no infinite loop.
  });
});
