/**
 * Browser + computer-use ports.
 *
 *   - `BrowserPort`         — DOM-first browser automation (Browser-use,
 *                              Playwright, MultiOn, Skyvern).
 *   - `ComputerActionPort`  — pixel-level computer-use (Anthropic CUA,
 *                              OpenAI Operator). For tests we ship a
 *                              `createMockComputerAgent`. Production
 *                              wiring lives behind an adapter.
 *
 * The Playwright adapter is shipped as a *factory builder* — we don't
 * import `playwright` directly so the package stays light. Callers
 * pass in a `playwright.chromium` (or similar) handle.
 *
 * Every action is timestamped with `Date.now()` so callers can splice
 * them into a `Trajectory`.
 */

import type {
  BrowserAction,
  BrowserActionResult,
  BrowserPort,
  ComputerAction,
  ComputerActionPort,
  ComputerActionResult,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────
// Browser port
// ─────────────────────────────────────────────────────────────────

export interface PlaywrightLike {
  readonly launch: (opts?: { readonly headless?: boolean }) => Promise<PlaywrightBrowserLike>;
}

export interface PlaywrightBrowserLike {
  readonly newPage: () => Promise<PlaywrightPageLike>;
  readonly close: () => Promise<void>;
}

export interface PlaywrightPageLike {
  readonly goto: (url: string) => Promise<unknown>;
  readonly click: (selector: string) => Promise<unknown>;
  readonly fill: (selector: string, value: string) => Promise<unknown>;
  readonly screenshot: (opts?: { readonly path?: string }) => Promise<Buffer>;
  readonly content: () => Promise<string>;
  readonly waitForTimeout: (ms: number) => Promise<void>;
}

export interface CreatePlaywrightBrowserAgentOptions {
  /** Injected `playwright.chromium` (or similar) handle. */
  readonly engine: PlaywrightLike;
  readonly headless?: boolean;
  /** Directory where screenshots are saved. */
  readonly screenshotDir?: string;
  /** Capture every action into this list (caller-owned). */
  readonly actionLog?: BrowserAction[];
}

export async function createPlaywrightBrowserAgent(
  options: CreatePlaywrightBrowserAgentOptions,
): Promise<BrowserPort> {
  const browser = await options.engine.launch({ headless: options.headless ?? true });
  const page = await browser.newPage();
  const log = options.actionLog;
  const screenshotDir = options.screenshotDir ?? '/tmp';

  const record = (action: BrowserAction): BrowserAction => {
    if (log) log.push(action);
    return action;
  };

  const port: BrowserPort = Object.freeze({
    goto: async (url: string): Promise<BrowserActionResult> => {
      record({ kind: 'goto', url, capturedAt: Date.now() });
      try {
        await page.goto(url);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
    click: async (selector: string): Promise<BrowserActionResult> => {
      record({ kind: 'click', selector, capturedAt: Date.now() });
      try {
        await page.click(selector);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
    type: async (selector: string, text: string): Promise<BrowserActionResult> => {
      record({ kind: 'type', selector, text, capturedAt: Date.now() });
      try {
        await page.fill(selector, text);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
    screenshot: async (): Promise<BrowserActionResult> => {
      const path = `${screenshotDir}/shot-${Date.now()}.png`;
      record({ kind: 'screenshot', capturedAt: Date.now() });
      try {
        await page.screenshot({ path });
        return { success: true, screenshotPath: path };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
    read: async (): Promise<BrowserActionResult> => {
      record({ kind: 'read', capturedAt: Date.now() });
      try {
        const html = await page.content();
        return { success: true, extractedText: html };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
    close: async (): Promise<void> => {
      await browser.close();
    },
  });
  return port;
}

// ─────────────────────────────────────────────────────────────────
// Mock browser (for tests + dry-runs)
// ─────────────────────────────────────────────────────────────────

export interface MockBrowserOptions {
  /** Optional canned responses keyed by action kind. */
  readonly responses?: Partial<Record<BrowserAction['kind'], BrowserActionResult>>;
}

export interface MockBrowserPort extends BrowserPort {
  readonly actions: ReadonlyArray<BrowserAction>;
  readonly reset: () => void;
}

export function createMockBrowserAgent(
  options: MockBrowserOptions = {},
): MockBrowserPort {
  const actions: BrowserAction[] = [];
  const responses = options.responses ?? {};

  const record = (action: BrowserAction): void => {
    actions.push(action);
  };

  const port: MockBrowserPort = {
    actions,
    reset: () => {
      actions.length = 0;
    },
    goto: async (url) => {
      record({ kind: 'goto', url, capturedAt: Date.now() });
      return responses['goto'] ?? { success: true };
    },
    click: async (selector) => {
      record({ kind: 'click', selector, capturedAt: Date.now() });
      return responses['click'] ?? { success: true };
    },
    type: async (selector, text) => {
      record({ kind: 'type', selector, text, capturedAt: Date.now() });
      return responses['type'] ?? { success: true };
    },
    screenshot: async () => {
      record({ kind: 'screenshot', capturedAt: Date.now() });
      return responses['screenshot'] ?? { success: true, screenshotPath: '/tmp/mock.png' };
    },
    read: async () => {
      record({ kind: 'read', capturedAt: Date.now() });
      return responses['read'] ?? { success: true, extractedText: '<html></html>' };
    },
  };
  return port;
}

// ─────────────────────────────────────────────────────────────────
// Computer action port
// ─────────────────────────────────────────────────────────────────

export interface MockComputerOptions {
  readonly responses?: Partial<Record<ComputerAction['kind'], ComputerActionResult>>;
}

export interface MockComputerActionPort extends ComputerActionPort {
  readonly actions: ReadonlyArray<ComputerAction>;
  readonly reset: () => void;
}

export function createMockComputerAgent(
  options: MockComputerOptions = {},
): MockComputerActionPort {
  const actions: ComputerAction[] = [];
  const responses = options.responses ?? {};

  const record = (action: ComputerAction): void => {
    actions.push(action);
  };

  const port: MockComputerActionPort = {
    actions,
    reset: () => {
      actions.length = 0;
    },
    key: async (keys) => {
      record({ kind: 'key', keys: [...keys], capturedAt: Date.now() });
      return responses['key'] ?? { success: true };
    },
    mouseClick: async (x, y) => {
      record({ kind: 'mouseClick', x, y, capturedAt: Date.now() });
      return responses['mouseClick'] ?? { success: true };
    },
    screenshot: async () => {
      record({ kind: 'screenshot', capturedAt: Date.now() });
      return responses['screenshot'] ?? { success: true, screenshotPath: '/tmp/screen.png' };
    },
    type: async (text) => {
      record({ kind: 'type', text, capturedAt: Date.now() });
      return responses['type'] ?? { success: true };
    },
  };
  return port;
}

/**
 * Adapter spec for a real computer-use back-end (Anthropic CUA,
 * OpenAI Operator). We define the shape rather than wire a specific
 * SDK so callers can plug any client.
 */
export interface ComputerUseBackend {
  readonly key: (keys: ReadonlyArray<string>) => Promise<ComputerActionResult>;
  readonly mouseClick: (x: number, y: number) => Promise<ComputerActionResult>;
  readonly screenshot: () => Promise<ComputerActionResult>;
  readonly type: (text: string) => Promise<ComputerActionResult>;
}

export interface CreateComputerActionPortOptions {
  readonly backend: ComputerUseBackend;
  readonly actionLog?: ComputerAction[];
}

export function createComputerActionPort(
  options: CreateComputerActionPortOptions,
): ComputerActionPort {
  const log = options.actionLog;
  const record = (action: ComputerAction): void => {
    if (log) log.push(action);
  };
  const port: ComputerActionPort = Object.freeze({
    key: async (keys: ReadonlyArray<string>): Promise<ComputerActionResult> => {
      record({ kind: 'key', keys: [...keys], capturedAt: Date.now() });
      return options.backend.key(keys);
    },
    mouseClick: async (x: number, y: number): Promise<ComputerActionResult> => {
      record({ kind: 'mouseClick', x, y, capturedAt: Date.now() });
      return options.backend.mouseClick(x, y);
    },
    screenshot: async (): Promise<ComputerActionResult> => {
      record({ kind: 'screenshot', capturedAt: Date.now() });
      return options.backend.screenshot();
    },
    type: async (text: string): Promise<ComputerActionResult> => {
      record({ kind: 'type', text, capturedAt: Date.now() });
      return options.backend.type(text);
    },
  });
  return port;
}
