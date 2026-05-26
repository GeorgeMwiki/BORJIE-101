import { describe, it, expect } from 'vitest';
import { installWhatsappCredentials } from '../auth/oauth.js';
import { rotateWhatsappAccessToken } from '../auth/token-refresh.js';
import type { EncryptedCredentialStore } from '../types.js';

const passthroughStore: EncryptedCredentialStore = {
  async seal(plaintext) {
    return new TextEncoder().encode(plaintext);
  },
  async open(ciphertext) {
    return new TextDecoder().decode(ciphertext);
  },
};

const FIXED_NOW = '2026-05-26T10:00:00.000Z';

describe('WhatsApp install + rotate', () => {
  it('seals all three secrets at install time', async () => {
    const creds = await installWhatsappCredentials(
      {
        tenantId: 'tenant_a',
        wabaId: 'waba_1',
        phoneNumberIds: ['pn_1'],
        systemUserAccessToken: 'sys-tok',
        appSecret: 'app-sec',
        webhookVerifyToken: 'wh-verify',
      },
      passthroughStore,
      () => FIXED_NOW,
    );
    expect(await passthroughStore.open(creds.encryptedAccessToken)).toBe('sys-tok');
    expect(await passthroughStore.open(creds.encryptedAppSecret)).toBe('app-sec');
    expect(await passthroughStore.open(creds.encryptedWebhookVerifyToken)).toBe(
      'wh-verify',
    );
  });

  it('rejects empty system-user token', async () => {
    await expect(
      installWhatsappCredentials(
        {
          tenantId: 'tenant_a',
          wabaId: 'waba_1',
          phoneNumberIds: ['pn_1'],
          systemUserAccessToken: '',
          appSecret: 'app-sec',
          webhookVerifyToken: 'wh-verify',
        },
        passthroughStore,
        () => FIXED_NOW,
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it('rotates only the access-token blob', async () => {
    const original = await installWhatsappCredentials(
      {
        tenantId: 'tenant_a',
        wabaId: 'waba_1',
        phoneNumberIds: ['pn_1'],
        systemUserAccessToken: 'sys-tok-v1',
        appSecret: 'app-sec',
        webhookVerifyToken: 'wh-verify',
      },
      passthroughStore,
      () => FIXED_NOW,
    );
    const rotated = await rotateWhatsappAccessToken(
      original,
      { newAccessToken: 'sys-tok-v2' },
      passthroughStore,
    );
    expect(await passthroughStore.open(rotated.encryptedAccessToken)).toBe(
      'sys-tok-v2',
    );
    expect(rotated.encryptedAppSecret).toBe(original.encryptedAppSecret);
    expect(rotated.encryptedWebhookVerifyToken).toBe(
      original.encryptedWebhookVerifyToken,
    );
  });
});
