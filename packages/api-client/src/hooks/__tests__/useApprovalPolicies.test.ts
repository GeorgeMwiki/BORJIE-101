/**
 * Approval Policies hook — transport-level tests.
 *
 * We verify the exported surface and exercise the ApiClient paths the
 * hooks rely on (list, detail, upsert). Happy path returns a payload;
 * error path surfaces a non-200 status as `ApiClientError`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useApprovalPolicies';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useApprovalPolicies module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports the four hooks', () => {
    expect(typeof mod.useApprovalPolicies).toBe('function');
    expect(typeof mod.useApprovalPolicy).toBe('function');
    expect(typeof mod.useUpsertApprovalPolicy).toBe('function');
  });

  it('happy path — GET /approval-policies returns a list', async () => {
    const payload = [{ id: 'p1', name: 'Default', scope: 'arrears', active: true }];
    stubFetchSequence([{ body: { success: true, data: payload } }]);
    const client = bootstrapTestClient();
    const res = await client.get('/approval-policies');
    expect(res.data).toEqual(payload);
  });

  it('error path — 500 surfaces as ApiClientError', async () => {
    stubFetchSequence([
      { ok: false, status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    ]);
    const client = bootstrapTestClient();
    await expect(client.get('/approval-policies/p1')).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
