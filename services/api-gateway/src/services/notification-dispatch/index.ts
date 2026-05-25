/**
 * Public surface for the notification-dispatch service.
 *
 * Composition wires this module:
 *
 *   const dispatcher = createNotificationDispatcher({
 *     db,
 *     logger,
 *     emailProvider: createStubEmailProvider(),  // swap for real
 *     smsProvider: createStubSmsProvider(),      // swap for real
 *   });
 *
 *   // Drain pending rows once (cron / on-demand):
 *   await dispatcher.runOnce({ tenantId });
 *
 *   // Or run as a long-lived worker:
 *   const ac = new AbortController();
 *   await dispatcher.runForever({ tenantId, signal: ac.signal });
 */
export {
  createNotificationDispatcher,
  type Dispatcher,
  type DispatcherDeps,
  type RunOnceInput,
  type RunOnceResult,
  type RunForeverInput,
} from './dispatcher-worker';

export {
  createStubEmailProvider,
  createInMemoryEmailProvider,
  type EmailProvider,
  type EmailProviderInput,
  type EmailProviderResult,
} from './email-provider';

export {
  createStubSmsProvider,
  createInMemorySmsProvider,
  type SmsProvider,
  type SmsProviderInput,
  type SmsProviderResult,
} from './sms-provider';
