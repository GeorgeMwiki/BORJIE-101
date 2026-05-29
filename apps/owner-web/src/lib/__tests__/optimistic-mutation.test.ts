import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { buildOptimisticMutation } from '../optimistic-mutation';

interface Task {
  readonly id: string;
  readonly title: string;
  readonly assigneeId: string | null;
}

interface AssignBody {
  readonly taskId: string;
  readonly assigneeId: string;
}

describe('lib/optimistic-mutation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('applies the optimistic transform immediately via onMutate', async () => {
    const initial: Task[] = [
      { id: 't1', title: 'Survey', assigneeId: null },
      { id: 't2', title: 'Inspect', assigneeId: null },
    ];
    queryClient.setQueryData(['tasks'], initial);

    const options = buildOptimisticMutation<Task[], AssignBody>({
      queryClient,
      queryKey: ['tasks'],
      mutationFn: async () => initial,
      applyOptimistic: (prev, body) =>
        prev?.map((t) =>
          t.id === body.taskId ? { ...t, assigneeId: body.assigneeId } : t,
        ),
    });

    await options.onMutate?.({ taskId: 't1', assigneeId: 'u-99' });

    const cached = queryClient.getQueryData<Task[]>(['tasks']);
    expect(cached?.[0]?.assigneeId).toBe('u-99');
    expect(cached?.[1]?.assigneeId).toBeNull();
  });

  it('rolls back to the snapshot on error', async () => {
    const initial: Task[] = [
      { id: 't1', title: 'Survey', assigneeId: 'original' },
    ];
    queryClient.setQueryData(['tasks'], initial);

    const options = buildOptimisticMutation<Task[], AssignBody>({
      queryClient,
      queryKey: ['tasks'],
      mutationFn: async () => initial,
      applyOptimistic: (prev, body) =>
        prev?.map((t) =>
          t.id === body.taskId ? { ...t, assigneeId: body.assigneeId } : t,
        ),
    });

    const context = await options.onMutate?.({
      taskId: 't1',
      assigneeId: 'u-99',
    });

    // Sanity — optimistic update lands first.
    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]?.assigneeId).toBe(
      'u-99',
    );

    // Simulate server reject — onError should rollback.
    options.onError?.(new Error('boom'), { taskId: 't1', assigneeId: 'u-99' }, context);

    const after = queryClient.getQueryData<Task[]>(['tasks']);
    expect(after?.[0]?.assigneeId).toBe('original');
  });

  it('cancels and rolls back related keys too', async () => {
    queryClient.setQueryData(['tasks', 'mine'], [{ id: 't1', value: 1 }]);
    queryClient.setQueryData(['tasks', 'pending'], [{ id: 't1', value: 1 }]);

    const options = buildOptimisticMutation<
      Array<{ id: string; value: number }>,
      { id: string }
    >({
      queryClient,
      queryKey: ['tasks', 'mine'],
      relatedKeys: [['tasks', 'pending']],
      mutationFn: async () => [],
      applyOptimistic: (prev) => prev?.map((t) => ({ ...t, value: 2 })),
    });

    const context = await options.onMutate?.({ id: 't1' });
    expect(queryClient.getQueryData<Array<{ value: number }>>(['tasks', 'mine'])?.[0]?.value).toBe(
      2,
    );

    options.onError?.(new Error('x'), { id: 't1' }, context);
    expect(queryClient.getQueryData<Array<{ value: number }>>(['tasks', 'mine'])?.[0]?.value).toBe(
      1,
    );
    expect(queryClient.getQueryData<Array<{ value: number }>>(['tasks', 'pending'])?.[0]?.value).toBe(
      1,
    );
  });

  it('handles undefined cache gracefully', async () => {
    const options = buildOptimisticMutation<Task[], AssignBody>({
      queryClient,
      queryKey: ['tasks'],
      mutationFn: async () => [],
      applyOptimistic: (prev) => prev, // pass-through
    });
    const ctx = await options.onMutate?.({
      taskId: 't1',
      assigneeId: 'u-99',
    });
    expect(ctx?.previous).toBeUndefined();
  });
});
