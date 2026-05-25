import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScanService,
  type IScanRepository,
  type IScanStoragePort,
  type ScanBundleRecord,
  type ScanPageRecord,
} from '../scan/scan-service.js';

class MemScanRepo implements IScanRepository {
  bundles = new Map<string, ScanBundleRecord>();
  pages = new Map<string, ScanPageRecord[]>();
  async createBundle(rec: ScanBundleRecord) { this.bundles.set(rec.id, rec); return rec; }
  async findBundle(id: string, tenantId: string) {
    const b = this.bundles.get(id); return b && b.tenantId === tenantId ? b : null;
  }
  async updateBundle(rec: ScanBundleRecord) { this.bundles.set(rec.id, rec); return rec; }
  async addPage(rec: ScanPageRecord) {
    const arr = this.pages.get(rec.bundleId) ?? [];
    arr.push(rec);
    this.pages.set(rec.bundleId, arr);
    return rec;
  }
  async listPages(bundleId: string) { return this.pages.get(bundleId) ?? []; }
}

class MemStorage implements IScanStoragePort {
  async upload(input: { tenantId: string; key: string; content: Buffer; contentType: string }) {
    return { key: input.key, url: `mem://${input.key}`, sizeBytes: input.content.length };
  }
}

describe('ScanService', () => {
  let svc: ScanService;
  let repo: MemScanRepo;

  beforeEach(() => {
    repo = new MemScanRepo();
    svc = new ScanService({ repository: repo, storage: new MemStorage() });
  });

  it('creates a draft bundle', async () => {
    const b = await svc.createBundle({ tenantId: 't1', createdBy: 'u1', title: 'Test' });
    expect(b.status).toBe('draft');
    expect(b.pageCount).toBe(0);
  });

  it('uploadPage increments page count and appends log', async () => {
    const b = await svc.createBundle({ tenantId: 't1', createdBy: 'u1' });
    const { bundle, page } = await svc.uploadPage({
      tenantId: 't1',
      bundleId: b.id,
      page: { dataUrl: 'data:image/png;base64,aGk=', mimeType: 'image/png' },
    });
    expect(bundle.pageCount).toBe(1);
    expect(page.pageNumber).toBe(1);
    expect(bundle.processingLog.at(-1)?.step).toBe('page_uploaded');
  });

  it('submitBundle transitions to submitted', async () => {
    const b = await svc.createBundle({ tenantId: 't1', createdBy: 'u1' });
    await svc.uploadPage({
      tenantId: 't1',
      bundleId: b.id,
      page: { dataUrl: 'data:image/png;base64,aGk=', mimeType: 'image/png' },
    });
    const submitted = await svc.submitBundle(b.id, 't1', 'u1');
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeDefined();
  });

  it('refuses submit with no pages', async () => {
    const b = await svc.createBundle({ tenantId: 't1', createdBy: 'u1' });
    await expect(svc.submitBundle(b.id, 't1', 'u1')).rejects.toThrow();
  });
});
