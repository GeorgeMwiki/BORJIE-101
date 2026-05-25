import { describe, expect, it } from 'vitest';

import {
  createComputerActionPort,
  createMockBrowserAgent,
  createMockComputerAgent,
  createPlaywrightBrowserAgent,
} from './index.js';
import type {
  BrowserAction,
  ComputerAction,
  ComputerActionResult,
  PlaywrightBrowserLike,
  PlaywrightLike,
  PlaywrightPageLike,
} from './index.js';

describe('browser-agent :: createMockBrowserAgent', () => {
  it('records every action with kind + timestamp', async () => {
    const agent = createMockBrowserAgent();
    await agent.goto('https://example.com');
    await agent.click('#btn');
    await agent.type('#in', 'hello');
    await agent.screenshot();
    await agent.read();
    expect(agent.actions.map((a) => a.kind)).toEqual([
      'goto',
      'click',
      'type',
      'screenshot',
      'read',
    ]);
    for (const a of agent.actions) {
      expect(typeof a.capturedAt).toBe('number');
    }
  });

  it('honours canned responses', async () => {
    const agent = createMockBrowserAgent({
      responses: {
        click: { success: false, error: 'selector missing' },
        read: { success: true, extractedText: 'fake-html' },
      },
    });
    const click = await agent.click('#x');
    expect(click.success).toBe(false);
    expect(click.error).toBe('selector missing');
    const read = await agent.read();
    expect(read.extractedText).toBe('fake-html');
  });

  it('reset clears the action log', async () => {
    const agent = createMockBrowserAgent();
    await agent.goto('https://x');
    agent.reset();
    expect(agent.actions).toHaveLength(0);
  });
});

describe('browser-agent :: createPlaywrightBrowserAgent', () => {
  function fakePlaywright(): {
    readonly engine: PlaywrightLike;
    readonly calls: string[];
  } {
    const calls: string[] = [];
    const page: PlaywrightPageLike = {
      goto: async (url: string) => {
        calls.push(`goto:${url}`);
        return undefined;
      },
      click: async (s: string) => {
        calls.push(`click:${s}`);
        return undefined;
      },
      fill: async (s: string, v: string) => {
        calls.push(`fill:${s}:${v}`);
        return undefined;
      },
      screenshot: async () => {
        calls.push('screenshot');
        return Buffer.from('png');
      },
      content: async () => '<html>ok</html>',
      waitForTimeout: async () => undefined,
    };
    const browser: PlaywrightBrowserLike = {
      newPage: async () => page,
      close: async () => {
        calls.push('close');
      },
    };
    const engine: PlaywrightLike = {
      launch: async (opts) => {
        calls.push(`launch:headless=${opts?.headless ?? true}`);
        return browser;
      },
    };
    return { engine, calls };
  }

  it('drives the injected playwright engine and records actions', async () => {
    const fake = fakePlaywright();
    const actionLog: BrowserAction[] = [];
    const port = await createPlaywrightBrowserAgent({
      engine: fake.engine,
      headless: true,
      actionLog,
    });
    await port.goto('https://example.com');
    await port.click('#btn');
    await port.type('#input', 'hello');
    const shot = await port.screenshot();
    const read = await port.read();
    expect(fake.calls).toContain('launch:headless=true');
    expect(fake.calls).toContain('goto:https://example.com');
    expect(fake.calls).toContain('click:#btn');
    expect(fake.calls).toContain('fill:#input:hello');
    expect(fake.calls).toContain('screenshot');
    expect(shot.screenshotPath).toMatch(/^\/tmp\/shot-\d+\.png$/);
    expect(read.extractedText).toContain('<html>');
    expect(actionLog.map((a) => a.kind)).toEqual([
      'goto',
      'click',
      'type',
      'screenshot',
      'read',
    ]);
    await port.close?.();
    expect(fake.calls).toContain('close');
  });

  it('surfaces errors as success=false instead of throwing', async () => {
    const fake = fakePlaywright();
    // Override `click` to throw.
    const broken = {
      ...fake.engine,
      launch: async () => ({
        newPage: async () => ({
          ...(await fake.engine.launch()).newPage(),
          click: async () => {
            throw new Error('selector missing');
          },
        }),
        close: async () => undefined,
      }),
    };
    const port = await createPlaywrightBrowserAgent({ engine: broken });
    const res = await port.click('#x');
    expect(res.success).toBe(false);
    expect(res.error).toContain('selector missing');
  });
});

describe('browser-agent :: createMockComputerAgent', () => {
  it('records every computer action', async () => {
    const agent = createMockComputerAgent();
    await agent.key(['Cmd', 'A']);
    await agent.mouseClick(100, 200);
    await agent.type('hi');
    await agent.screenshot();
    expect(agent.actions.map((a) => a.kind)).toEqual([
      'key',
      'mouseClick',
      'type',
      'screenshot',
    ]);
    expect(agent.actions[0]?.keys).toEqual(['Cmd', 'A']);
    expect(agent.actions[1]?.x).toBe(100);
    expect(agent.actions[1]?.y).toBe(200);
  });

  it('returns canned responses when configured', async () => {
    const agent = createMockComputerAgent({
      responses: { type: { success: false, error: 'not focused' } },
    });
    const res = await agent.type('x');
    expect(res.success).toBe(false);
    expect(res.error).toBe('not focused');
  });
});

describe('browser-agent :: createComputerActionPort', () => {
  it('forwards every action to the backend and records to actionLog', async () => {
    const log: ComputerAction[] = [];
    const backendCalls: string[] = [];
    const backend = {
      key: async (keys: ReadonlyArray<string>): Promise<ComputerActionResult> => {
        backendCalls.push(`key:${keys.join('+')}`);
        return { success: true };
      },
      mouseClick: async (x: number, y: number): Promise<ComputerActionResult> => {
        backendCalls.push(`click:${x},${y}`);
        return { success: true };
      },
      screenshot: async (): Promise<ComputerActionResult> => {
        backendCalls.push('shot');
        return { success: true, screenshotPath: '/tmp/shot.png' };
      },
      type: async (text: string): Promise<ComputerActionResult> => {
        backendCalls.push(`type:${text}`);
        return { success: true };
      },
    };
    const port = createComputerActionPort({ backend, actionLog: log });
    await port.key(['Cmd', 'C']);
    await port.mouseClick(10, 20);
    await port.screenshot();
    await port.type('hello');
    expect(backendCalls).toEqual(['key:Cmd+C', 'click:10,20', 'shot', 'type:hello']);
    expect(log).toHaveLength(4);
    expect(log[2]?.kind).toBe('screenshot');
  });
});
