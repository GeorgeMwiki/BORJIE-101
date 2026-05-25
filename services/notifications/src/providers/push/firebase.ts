/**
 * Firebase Cloud Messaging Push Provider
 */

import * as admin from 'firebase-admin';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface FirebaseConfig {
  projectId: string;
  clientEmail?: string;
  privateKey?: string;
  credentialsPath?: string;
}

const tenantApps = new Map<string, admin.app.App>();

export class FirebasePushProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'push';
  readonly name = 'Firebase Cloud Messaging';

  static registerConfig(tenantId: TenantId, config: FirebaseConfig): void {
    const appName = `tenant-${tenantId}`;
    if (admin.apps.some((a) => a?.name === appName)) {
      return;
    }

    let credential: admin.credential.Credential;
    if (config.credentialsPath) {
      credential = admin.credential.cert(config.credentialsPath);
    } else if (config.clientEmail && config.privateKey) {
      credential = admin.credential.cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey.replace(/\\n/g, '\n'),
      });
    } else {
      throw new Error('Firebase config requires credentialsPath or (clientEmail + privateKey)');
    }

    const app = admin.initializeApp(
      { credential, projectId: config.projectId },
      appName
    );
    tenantApps.set(tenantId as string, app);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantApps.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const app = tenantApps.get(params.tenantId as string);
    if (!app) {
      return { success: false, error: 'Firebase push not configured for tenant' };
    }

    try {
      const messaging = admin.messaging(app);
      const message: admin.messaging.Message = {
        token: params.to,
        notification: {
          title: params.title ?? 'Notification',
          body: params.body,
        },
        data: params.data ?? {},
        android: { priority: 'high' },
        apns: {
          payload: {
            aps: {
              alert: { title: params.title, body: params.body },
              sound: 'default',
            },
          },
        },
      };

      const response = await messaging.send(message);
      return { success: true, externalId: response };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const firebasePushProvider = new FirebasePushProvider();
