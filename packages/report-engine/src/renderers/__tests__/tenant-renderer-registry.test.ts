/**
 * R22 — tenant renderer registry tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTenantRendererRegistry,
  getTenantRenderer,
  listTenantsWithCustomRenderers,
  registerTenantRenderer,
  resolveRendererStack,
} from '../tenant-renderer-registry';
import type { RenderedReportFile } from '../../types.js';

const renderedStub: RenderedReportFile = {
  format: 'docx',
  filename: 'stub.docx',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

afterEach(() => {
  clearTenantRendererRegistry();
});

describe('tenant-renderer-registry', () => {
  it('returns undefined for an unregistered tenant', () => {
    expect(getTenantRenderer('nobody')).toBeUndefined();
  });

  it('registers + reads per-tenant overrides', () => {
    const docx = vi.fn().mockReturnValue(renderedStub);
    registerTenantRenderer('tenant-1', { docx });
    expect(getTenantRenderer('tenant-1')).toBeDefined();
    expect(getTenantRenderer('tenant-1')?.docx).toBe(docx);
  });

  it('clears with null', () => {
    registerTenantRenderer('tenant-1', { docx: vi.fn() });
    registerTenantRenderer('tenant-1', null);
    expect(getTenantRenderer('tenant-1')).toBeUndefined();
  });

  it('explicit override wins over per-tenant registry', () => {
    const tenantDocx = vi.fn().mockReturnValue(renderedStub);
    const explicitDocx = vi.fn().mockReturnValue(renderedStub);
    registerTenantRenderer('tenant-2', { docx: tenantDocx });
    const stack = resolveRendererStack('tenant-2', { docx: explicitDocx });
    expect(stack?.docx).toBe(explicitDocx);
  });

  it('per-tenant fills slots the explicit override leaves empty', () => {
    const tenantPdf = vi.fn().mockReturnValue(renderedStub);
    const explicitDocx = vi.fn().mockReturnValue(renderedStub);
    registerTenantRenderer('tenant-3', { pdf: tenantPdf });
    const stack = resolveRendererStack('tenant-3', { docx: explicitDocx });
    expect(stack?.pdf).toBe(tenantPdf);
    expect(stack?.docx).toBe(explicitDocx);
  });

  it('lists tenants with custom renderers, sorted', () => {
    registerTenantRenderer('tenant-z', { docx: vi.fn() });
    registerTenantRenderer('tenant-a', { docx: vi.fn() });
    registerTenantRenderer('tenant-m', { docx: vi.fn() });
    expect(listTenantsWithCustomRenderers()).toEqual([
      'tenant-a',
      'tenant-m',
      'tenant-z',
    ]);
  });
});
