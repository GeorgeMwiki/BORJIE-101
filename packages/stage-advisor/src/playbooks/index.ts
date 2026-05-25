/**
 * Playbook engine — evaluates which tasks an org has completed and
 * surfaces the next N incomplete tasks for the brain to introduce.
 *
 * Pure: every fn here is `state → result` with no side effects.
 */

import type {
  OrgStage,
  OrgState,
  PlaybookObjective,
  PlaybookTask,
  StagePlaybook,
} from '../types.js';

export interface TaskEvaluation {
  readonly task: PlaybookTask;
  readonly objective: PlaybookObjective;
  readonly completed: boolean;
}

export interface PlaybookEvaluation {
  readonly stage: OrgStage;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly completionRatio: number;
  readonly evaluations: ReadonlyArray<TaskEvaluation>;
  readonly nextIncompleteTasks: ReadonlyArray<TaskEvaluation>;
}

export interface EvaluatePlaybookInput {
  readonly playbook: StagePlaybook;
  readonly orgState: OrgState;
  /** How many incomplete tasks to return in `nextIncompleteTasks`. */
  readonly nextN?: number;
}

/**
 * Walk every task in the playbook, run its predicate against the org
 * state, and produce a deterministic summary the UI can render.
 */
export function evaluatePlaybook(
  input: EvaluatePlaybookInput,
): PlaybookEvaluation {
  const nextN = input.nextN ?? 3;
  const evaluations: TaskEvaluation[] = [];
  for (const objective of input.playbook.objectives) {
    for (const task of objective.tasks) {
      let completed: boolean;
      try {
        completed = task.completionPredicate(input.orgState);
      } catch {
        // A throwing predicate is treated as "not done" so a malformed
        // state never crashes the whole evaluation. Predicates should
        // be tolerant — but this is belt-and-braces.
        completed = false;
      }
      evaluations.push({ task, objective, completed });
    }
  }
  const completedTasks = evaluations.filter((e) => e.completed).length;
  const totalTasks = evaluations.length;
  const completionRatio = totalTasks === 0 ? 0 : completedTasks / totalTasks;
  const nextIncompleteTasks = evaluations
    .filter((e) => !e.completed)
    .slice(0, Math.max(0, nextN));
  return {
    stage: input.playbook.stage,
    totalTasks,
    completedTasks,
    completionRatio,
    evaluations,
    nextIncompleteTasks,
  };
}

export {
  buildPlaybook,
  PRE_LAUNCH_PLAYBOOK,
  SEEDLING_PLAYBOOK,
  SPROUT_PLAYBOOK,
  SAPLING_PLAYBOOK,
  TREE_PLAYBOOK,
  FOREST_PLAYBOOK,
  ECOSYSTEM_PLAYBOOK,
  type PlaybookSeed,
} from './stage-playbooks.js';
