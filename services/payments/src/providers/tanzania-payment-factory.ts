/**
 * Tanzania payment provider factory.
 * Routes to direct GePG or PSP adapter based on config.
 * Default in production is ClickPesa (PSP shortcut) per research
 * recommendation — direct GePG onboarding takes 3–6 months.
 */

import { ClickPesaProvider, type ClickPesaConfig } from './clickpesa/clickpesa-provider.js';
import { loadGepgKeys } from './gepg/key-loader.js';

export type TanzaniaPaymentBackend = 'gepg-direct' | 'clickpesa' | 'azampay' | 'selcom';

export interface TanzaniaPaymentProviderConfig {
  readonly backend: TanzaniaPaymentBackend;
  readonly clickpesa?: ClickPesaConfig;
  readonly gepg?: {
    readonly spCode: string;
    readonly baseUrl: string;
    readonly sandbox: boolean;
  };
  readonly azampay?: { readonly apiKey: string; readonly baseUrl: string };
  readonly selcom?: { readonly apiKey: string; readonly baseUrl: string };
}

export interface TanzaniaPaymentProvider {
  readonly backend: TanzaniaPaymentBackend;
  requestControlNumber(input: {
    invoiceId: string;
    amountMinor: number;
    payerPhone: string;
    description?: string;
  }): Promise<{
    controlNumber: string;
    expiresAt: string;
    status: 'issued' | 'paid' | 'failed';
  }>;
  healthCheck(): Promise<{ healthy: boolean; error?: string }>;
}

class ClickPesaAdapter implements TanzaniaPaymentProvider {
  readonly backend: TanzaniaPaymentBackend = 'clickpesa';
  constructor(private readonly inner: ClickPesaProvider) {}
  async requestControlNumber(input: {
    invoiceId: string;
    amountMinor: number;
    payerPhone: string;
    description?: string;
  }) {
    const r = await this.inner.requestPayment({
      invoiceId: input.invoiceId,
      amountMinor: input.amountMinor,
      currency: 'TZS',
      payerPhone: input.payerPhone,
      description: input.description,
    });
    return {
      controlNumber: r.controlNumber,
      expiresAt: r.expiresAt,
      status: r.status,
    };
  }
  healthCheck() {
    return this.inner.healthCheck();
  }
}

class StubAdapter implements TanzaniaPaymentProvider {
  constructor(readonly backend: TanzaniaPaymentBackend, readonly reason: string) {}
  async requestControlNumber(): Promise<never> {
    throw new Error(`${this.backend} adapter not configured: ${this.reason}`);
  }
  async healthCheck() {
    return { healthy: false, error: this.reason };
  }
}

export function getTanzaniaPaymentProvider(
  config: TanzaniaPaymentProviderConfig
): TanzaniaPaymentProvider {
  switch (config.backend) {
    case 'clickpesa': {
      if (!config.clickpesa) {
        return new StubAdapter('clickpesa', 'no clickpesa config provided');
      }
      return new ClickPesaAdapter(new ClickPesaProvider(config.clickpesa));
    }
    case 'gepg-direct': {
      const keys = loadGepgKeys();
      if (keys.source === 'missing') {
        return new StubAdapter(
          'gepg-direct',
          'GEPG_SIGNING_KEY / GEPG_SIGNING_CERT not configured'
        );
      }
      // Direct GePG adapter would wrap the existing gepg-provider.ts here.
      return new StubAdapter('gepg-direct', 'direct GePG adapter requires gepg-provider wiring');
    }
    case 'azampay':
      return new StubAdapter('azampay', 'Azampay adapter not yet implemented');
    case 'selcom':
      return new StubAdapter('selcom', 'Selcom adapter not yet implemented');
    default: {
      const exhaustive: never = config.backend;
      throw new Error(`Unknown Tanzania payment backend: ${String(exhaustive)}`);
    }
  }
}

export function defaultTanzaniaBackend(): TanzaniaPaymentBackend {
  const env = process.env.TANZANIA_PAYMENT_BACKEND?.toLowerCase();
  if (env === 'gepg-direct' || env === 'clickpesa' || env === 'azampay' || env === 'selcom') {
    return env;
  }
  // Per research Q2: default to ClickPesa PSP shortcut.
  return 'clickpesa';
}
