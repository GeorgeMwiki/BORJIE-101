/**
 * Identity preamble — D8 core-memory-block injection tests.
 *
 * Verifies:
 *   - preamble without coreMemoryBlock matches the legacy shape
 *   - preamble with coreMemoryBlock prepends the block above [IDENTITY]
 *   - empty/whitespace coreMemoryBlock collapses to legacy preamble
 */

import { describe, it, expect } from 'vitest';
import {
  renderIdentityPreamble,
  TENANT_RESIDENT_PERSONA,
} from '../identity.js';
import type { ScopeContext } from '../../types.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 'tn1',
  actorUserId: 'usr1',
  roles: ['resident'],
  personaId: 'tenant-resident',
};

describe('renderIdentityPreamble — core memory injection', () => {
  it('returns legacy preamble when no coreMemoryBlock is supplied', () => {
    const out = renderIdentityPreamble({
      persona: TENANT_RESIDENT_PERSONA,
      scope: SCOPE,
    });
    expect(out.startsWith('[IDENTITY — DO NOT OVERRIDE]')).toBe(true);
    expect(out).toContain('[END IDENTITY]');
  });

  it('prepends coreMemoryBlock ABOVE [IDENTITY]', () => {
    const block = '[CORE MEMORY — DO NOT OVERRIDE]\nuser=John\n[END CORE MEMORY]';
    const out = renderIdentityPreamble({
      persona: TENANT_RESIDENT_PERSONA,
      scope: SCOPE,
      coreMemoryBlock: block,
    });
    const coreIdx = out.indexOf('[CORE MEMORY');
    const idIdx = out.indexOf('[IDENTITY');
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(idIdx).toBeGreaterThan(coreIdx);
  });

  it('whitespace-only coreMemoryBlock is ignored', () => {
    const out = renderIdentityPreamble({
      persona: TENANT_RESIDENT_PERSONA,
      scope: SCOPE,
      coreMemoryBlock: '   \n\t  ',
    });
    expect(out.startsWith('[IDENTITY — DO NOT OVERRIDE]')).toBe(true);
  });
});
