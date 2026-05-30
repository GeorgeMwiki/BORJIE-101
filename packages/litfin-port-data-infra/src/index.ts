/**
 * @borjie/litfin-port-data-infra — LITFIN-ported data + infra primitives.
 *
 * Layered alongside Borjie's native packages:
 *   - @borjie/tenant-isolation-guard (richer, native)
 *   - @borjie/workflow-engine (richer, native)
 *   - services/payments-ledger LedgerService (canonical money path)
 *
 * This port adds the verbatim LITFIN signatures (tenant-guard primitives,
 * append-only event store, cooperative kernel, error codes) so code paths
 * that originated in LitFin can land in Borjie without rewriting their
 * import surface. The Borjie native equivalents remain the source of
 * truth for production wiring; this package is the bridge.
 *
 * Sub-paths:
 *   @borjie/litfin-port-data-infra/tenant-guard
 *   @borjie/litfin-port-data-infra/ledger
 *   @borjie/litfin-port-data-infra/community-kernel
 *   @borjie/litfin-port-data-infra/errors
 */

export * as tenantGuard from "./tenant-guard/index";
export * as ledger from "./ledger/index";
export * as communityKernel from "./community-kernel/index";
export * as errors from "./errors/index";
