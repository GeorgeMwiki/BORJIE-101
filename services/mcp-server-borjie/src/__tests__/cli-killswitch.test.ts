import { describe, it, expect } from 'vitest';
import { evalKillSwitchOpen } from '../cli.js';

/**
 * The stdio kill-switch gate must FAIL CLOSED, mirroring the canonical
 * kernel semantics (central-intelligence kernel/killswitch.ts `parseLevel`):
 * ONLY an explicit safe value allows traffic; every unknown/ambiguous value
 * denies. `evalKillSwitchOpen` returns `true` when the kill-switch is
 * ENGAGED (deny the tool call).
 */
describe('evalKillSwitchOpen (stdio kill-switch gate)', () => {
  it('DENIES (open=true) on a hard halt', () => {
    expect(evalKillSwitchOpen('halt')).toBe(true);
    expect(evalKillSwitchOpen(' HALT ')).toBe(true);
  });

  it('ALLOWS (open=false) on explicit safe values', () => {
    expect(evalKillSwitchOpen('live')).toBe(false);
    expect(evalKillSwitchOpen('LIVE')).toBe(false);
    expect(evalKillSwitchOpen('off')).toBe(false);
    expect(evalKillSwitchOpen('')).toBe(false);
    expect(evalKillSwitchOpen('   ')).toBe(false);
    expect(evalKillSwitchOpen(undefined)).toBe(false);
  });

  it('FAILS CLOSED (open=true) on garbage / ambiguous / typo states', () => {
    // The pre-fix `state === 'halt'` check let ALL of these fail OPEN.
    expect(evalKillSwitchOpen('halted')).toBe(true); // typo of halt
    expect(evalKillSwitchOpen('hal')).toBe(true); // truncated
    expect(evalKillSwitchOpen('paused')).toBe(true);
    expect(evalKillSwitchOpen('true')).toBe(true);
    expect(evalKillSwitchOpen('1')).toBe(true);
    expect(evalKillSwitchOpen('???')).toBe(true);
    expect(evalKillSwitchOpen('livee')).toBe(true); // typo of live
  });

  it('FAILS CLOSED (open=true) on degraded (kernel restricts, no stakes signal here)', () => {
    expect(evalKillSwitchOpen('degraded')).toBe(true);
    expect(evalKillSwitchOpen('DEGRADED')).toBe(true);
  });

  it('reads process.env.KILLSWITCH_STATE when no arg is passed', () => {
    const prev = process.env['KILLSWITCH_STATE'];
    try {
      process.env['KILLSWITCH_STATE'] = 'halt';
      expect(evalKillSwitchOpen()).toBe(true);
      process.env['KILLSWITCH_STATE'] = 'live';
      expect(evalKillSwitchOpen()).toBe(false);
      delete process.env['KILLSWITCH_STATE'];
      expect(evalKillSwitchOpen()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env['KILLSWITCH_STATE'];
      else process.env['KILLSWITCH_STATE'] = prev;
    }
  });
});
