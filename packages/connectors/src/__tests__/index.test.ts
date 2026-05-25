/**
 * Public-surface verification for @borjie/connectors.
 * Ensures the index re-exports remain stable so downstream services don't
 * silently break when adapters or sinks are renamed.
 */

import { describe, it, expect } from 'vitest';
import * as connectors from '../index.js';

describe('@borjie/connectors — public surface', () => {
  it('re-exports createBaseConnector', () => {
    expect(typeof connectors.createBaseConnector).toBe('function');
  });

  it('re-exports createInMemoryEventSink', () => {
    expect(typeof connectors.createInMemoryEventSink).toBe('function');
  });

  it('re-exports createInMemoryAuditSink', () => {
    expect(typeof connectors.createInMemoryAuditSink).toBe('function');
  });

  it('re-exports createMpesaAdapter', () => {
    expect(typeof connectors.createMpesaAdapter).toBe('function');
  });

  it('re-exports createCreditBureauAdapter', () => {
    expect(typeof connectors.createCreditBureauAdapter).toBe('function');
  });

  it('re-exports InitiatePaymentInputSchema as a Zod schema', () => {
    expect(connectors.InitiatePaymentInputSchema).toBeDefined();
    expect(typeof connectors.InitiatePaymentInputSchema.safeParse).toBe('function');
  });

  it('re-exports InitiatePaymentOutputSchema as a Zod schema', () => {
    expect(connectors.InitiatePaymentOutputSchema).toBeDefined();
    expect(typeof connectors.InitiatePaymentOutputSchema.safeParse).toBe('function');
  });

  it('re-exports FetchScoreInputSchema as a Zod schema', () => {
    expect(connectors.FetchScoreInputSchema).toBeDefined();
    expect(typeof connectors.FetchScoreInputSchema.safeParse).toBe('function');
  });

  it('re-exports CreditScoreReportSchema as a Zod schema', () => {
    expect(connectors.CreditScoreReportSchema).toBeDefined();
    expect(typeof connectors.CreditScoreReportSchema.safeParse).toBe('function');
  });
});

describe('@borjie/connectors — factory composition', () => {
  it('createInMemoryEventSink and createInMemoryAuditSink can be wired through createBaseConnector', () => {
    const events = connectors.createInMemoryEventSink();
    const audit = connectors.createInMemoryAuditSink();

    const connector = connectors.createBaseConnector({
      config: {
        id: 'composition-test',
        displayName: 'Composition Test',
        baseUrl: 'https://api.example.test',
      },
      events,
      audit,
    });

    expect(connector.id).toBe('composition-test');
    expect(connector.health().state).toBe('closed');
  });
});
