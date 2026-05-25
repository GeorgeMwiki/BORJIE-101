/**
 * Disclosure-audit — every disclosure logged as J1 entity.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 */

export {
  type DisclosureAuditEvent,
  type DisclosureAuditQuery,
  type DisclosureAuditSink,
  type LogDisclosureInput,
} from './types.js';
export {
  buildDisclosureEvent,
  logDisclosure,
  InMemoryDisclosureAuditSink,
} from './audit.js';
