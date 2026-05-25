import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetNationalIdResolver,
  setNationalIdResolver,
  validateNationalId,
} from '../../validators/national-id.js';
import '../../countries/index.js'; // side-effect: wires resolver

afterEach(() => {
  // Re-install the country resolver after any override.
  setNationalIdResolver((iso) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('../../countries/index.js');
    const profile = mod.EXTENDED_PROFILES[iso];
    return profile?.nationalIdValidator ?? null;
  });
});

describe('validateNationalId', () => {
  it('returns validation-unavailable for unknown country', () => {
    __resetNationalIdResolver();
    const r = validateNationalId('12345', 'XX');
    expect(r.status).toBe('validation-unavailable');
  });

  it('rejects empty id', () => {
    const r = validateNationalId('', 'DE');
    expect(r.status).toBe('invalid');
  });

  it('dispatches to DE validator', () => {
    setNationalIdResolver((iso) =>
      iso === 'DE'
        ? { validate: () => ({ status: 'valid', ruleId: 'stub-de' }) }
        : null
    );
    const r = validateNationalId('L01X00T47', 'DE');
    expect(r.status).toBe('valid');
  });

  it('reports validation-unavailable when resolver returns null', () => {
    setNationalIdResolver(() => null);
    const r = validateNationalId('12345', 'DE');
    expect(r.status).toBe('validation-unavailable');
  });
});
