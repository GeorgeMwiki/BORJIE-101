/**
 * @borjie/litfin-port-learning-shape — LITFIN-ported learning shape primitives.
 *
 * Sub-paths:
 *   @borjie/litfin-port-learning-shape/adaptive       — skill mastery curve
 *   @borjie/litfin-port-learning-shape/micro-learning — 60-180s tile catalogue
 *   @borjie/litfin-port-learning-shape/outcomes       — OaaS pricing + invoices
 *   @borjie/litfin-port-learning-shape/funnel         — visitor->outcome funnel + demo-storage
 *   @borjie/litfin-port-learning-shape/feedback       — per-surface feedback summary
 *   @borjie/litfin-port-learning-shape/proactive      — nudge / continuous-learning engine
 *
 * Layered alongside Borjie's richer native packages
 * (@borjie/meta-learning-conductor, @borjie/outcomes, @borjie/proactive-intel,
 * @borjie/analytics). These ports add a verbatim LITFIN signature so
 * cross-pollinated logic lands cleanly.
 */

export * as adaptive from "./adaptive/index";
export * as microLearning from "./micro-learning/index";
export * as outcomes from "./outcomes/index";
export * as funnel from "./funnel/index";
export * as feedback from "./feedback/index";
export * as proactive from "./proactive/index";
