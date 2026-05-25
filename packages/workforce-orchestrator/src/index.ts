/**
 * @borjie/workforce-orchestrator — Piece M.
 *
 * The agentic workforce manager. Powers task assignment, follow-up
 * scheduling, check-in processing, performance signal tracking,
 * escalation routing, coaching content generation, weekly advisory
 * briefs, and per-employee skill inference.
 *
 * Architecture:
 *
 *     [manager / T3 / T2 / kernel]
 *                ↓ assignTask()
 *     [work_assignments] ──┬→ followups → notifications-service
 *           ↑              │
 *           │              ↓
 *           │   [work_check_ins] → performance_signals
 *           │              │              │
 *           │              │              ├→ skill_assessments
 *           │              │              ├→ coaching_prompts
 *           │              ↓              └→ escalations → tickets
 *           │   [advisory_briefs]
 *           └────── (HITL gate)
 *
 * All ports (store / channel / audit / content / tickets) are wired by
 * the api-gateway composition root. The package itself is dependency-
 * injected; nothing reaches out for environment, clock, or random.
 */

export * from './types.js';
export * from './assign-task.js';
export * from './followup-scheduler.js';
export * from './check-in-receiver.js';
export * from './sentiment-analyzer.js';
export * from './performance-tracker.js';
export * from './escalation-rules.js';
export * from './coaching-generator.js';
export * from './advisory-brief-engine.js';
export * from './skill-inferrer.js';
