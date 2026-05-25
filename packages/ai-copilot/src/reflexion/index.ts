/**
 * Reflexion — Phase E gap-closure (P8 Gap 7).
 *
 * Public barrel. Wires the CoT → eval → lesson → next-system-prompt
 * feedback loop (Shinn et al. 2023, arXiv:2303.11366).
 *
 * Typical wiring (inside the post-turn pipeline):
 *
 *   import {
 *     distillLesson,
 *     createInMemoryLessonStore,
 *     renderLessons,
 *   } from '@borjie/ai-copilot/reflexion';
 *
 *   const store = createInMemoryLessonStore();
 *
 *   // post-turn:
 *   const lesson = distillLesson(cotTrace, outcome, judgeVerdict);
 *   if (lesson) await store.put(lesson);
 *
 *   // pre-next-turn:
 *   const fragment = await renderLessons(store, tenantId, taskTag);
 *   const systemPrompt = fragment
 *     ? `${fragment}\n\n${baseSystemPrompt}`
 *     : baseSystemPrompt;
 */

export * from './types.js';
export { distillLesson } from './lesson-distiller.js';
export type { DistillerDeps } from './lesson-distiller.js';
export { createInMemoryLessonStore } from './lesson-store.js';
export { renderLessons } from './lesson-renderer.js';
