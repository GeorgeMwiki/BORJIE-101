/**
 * Minimal ioredis test double.
 *
 * Covers ONLY the subset of operations used by
 * `RedisPreferencesStore` and `RedisInAppNotificationStore`:
 *   * GET / SET (with `'XX'` mode)
 *   * DEL
 *   * SADD / SREM / SMEMBERS
 *   * WATCH / MULTI / EXEC
 *   * pipeline() (only GET inside)
 *
 * The mock is single-threaded (matching Node's event loop) so the
 * Redis adapter's WATCH/MULTI/EXEC happens-before semantics map to
 * simple variable reads. It does NOT simulate WATCH races (none of
 * the existing test scenarios exercise concurrent writers); the
 * adapter's CAS retry loop is exercised by the typecheck path only.
 */

interface MultiCmd {
  readonly cmd: 'set' | 'del' | 'sadd' | 'srem';
  readonly args: readonly unknown[];
}

export interface IoredisMock {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode?: 'XX' | 'NX'
  ): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  watch(...keys: string[]): Promise<'OK'>;
  multi(): IoredisMultiMock;
  pipeline(): IoredisMultiMock;
  on(event: string, handler: (...args: unknown[]) => void): IoredisMock;
}

export interface IoredisMultiMock {
  set(key: string, value: string): IoredisMultiMock;
  del(...keys: string[]): IoredisMultiMock;
  sadd(key: string, ...members: string[]): IoredisMultiMock;
  srem(key: string, ...members: string[]): IoredisMultiMock;
  get(key: string): IoredisMultiMock;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export function createIoredisMock(): IoredisMock {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  function getSet(key: string): Set<string> {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  }

  function applyCmd(
    cmd: MultiCmd
  ): { result: unknown; isGet: boolean } {
    switch (cmd.cmd) {
      case 'set': {
        const [key, value] = cmd.args as [string, string];
        strings.set(key, value);
        return { result: 'OK', isGet: false };
      }
      case 'del': {
        let removed = 0;
        for (const k of cmd.args as string[]) {
          if (strings.delete(k)) removed++;
          if (sets.delete(k)) removed++;
        }
        return { result: removed, isGet: false };
      }
      case 'sadd': {
        const [key, ...members] = cmd.args as [string, ...string[]];
        const s = getSet(key);
        let added = 0;
        for (const m of members) {
          if (!s.has(m)) {
            s.add(m);
            added++;
          }
        }
        return { result: added, isGet: false };
      }
      case 'srem': {
        const [key, ...members] = cmd.args as [string, ...string[]];
        const s = sets.get(key);
        if (!s) return { result: 0, isGet: false };
        let removed = 0;
        for (const m of members) {
          if (s.delete(m)) removed++;
        }
        return { result: removed, isGet: false };
      }
    }
  }

  function buildMulti(): IoredisMultiMock {
    const queued: Array<MultiCmd | { cmd: 'get'; args: [string] }> = [];
    const chain: IoredisMultiMock = {
      set(key, value) {
        queued.push({ cmd: 'set', args: [key, value] });
        return chain;
      },
      del(...keys) {
        queued.push({ cmd: 'del', args: keys });
        return chain;
      },
      sadd(key, ...members) {
        queued.push({ cmd: 'sadd', args: [key, ...members] });
        return chain;
      },
      srem(key, ...members) {
        queued.push({ cmd: 'srem', args: [key, ...members] });
        return chain;
      },
      get(key) {
        queued.push({ cmd: 'get', args: [key] });
        return chain;
      },
      async exec() {
        const out: Array<[Error | null, unknown]> = [];
        for (const c of queued) {
          if (c.cmd === 'get') {
            out.push([null, strings.get(c.args[0]) ?? null]);
            continue;
          }
          const { result } = applyCmd(c);
          out.push([null, result]);
        }
        return out;
      },
    };
    return chain;
  }

  const client: IoredisMock = {
    async get(key) {
      return strings.get(key) ?? null;
    },
    async set(key, value, mode) {
      if (mode === 'XX' && !strings.has(key)) return null;
      if (mode === 'NX' && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    },
    async del(...keys) {
      let removed = 0;
      for (const k of keys) {
        if (strings.delete(k)) removed++;
        if (sets.delete(k)) removed++;
      }
      return removed;
    },
    async sadd(key, ...members) {
      const s = getSet(key);
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    },
    async srem(key, ...members) {
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const m of members) {
        if (s.delete(m)) removed++;
      }
      return removed;
    },
    async smembers(key) {
      const s = sets.get(key);
      return s ? Array.from(s) : [];
    },
    async watch() {
      return 'OK';
    },
    multi() {
      return buildMulti();
    },
    pipeline() {
      return buildMulti();
    },
    on() {
      return client;
    },
  };

  return client;
}
