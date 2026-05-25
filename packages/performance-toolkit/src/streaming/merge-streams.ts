/**
 * `mergeStreams` — interleave multiple async iterables into one,
 * yielding items in arrival order. Useful when fanning out to several
 * upstream LLM calls (Claude + GPT + Mistral) for a vote-and-debate
 * pipeline.
 *
 *   for await (const item of mergeStreams(a, b, c)) { … }
 *
 * `orderedMerge` is the alternate variant — preserves per-source
 * ordering by round-robining one item from each source until exhausted.
 */

export async function* mergeStreams<T>(
  ...streams: AsyncIterable<T>[]
): AsyncIterable<T> {
  if (streams.length === 0) return;
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());
  type Result = { i: number; res: IteratorResult<T> };
  const pending = new Map<number, Promise<Result>>();
  const arm = (i: number): void => {
    pending.set(
      i,
      iterators[i]!.next().then((res) => ({ i, res })),
    );
  };
  iterators.forEach((_, i) => arm(i));

  while (pending.size > 0) {
    const { i, res } = await Promise.race(pending.values());
    pending.delete(i);
    if (res.done === true) continue;
    yield res.value;
    arm(i);
  }
}

/**
 * Round-robin variant. Useful when caller wants fairness across
 * sources rather than raw arrival order.
 */
export async function* orderedMerge<T>(
  ...streams: AsyncIterable<T>[]
): AsyncIterable<T> {
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());
  const exhausted = new Set<number>();
  while (exhausted.size < iterators.length) {
    for (let i = 0; i < iterators.length; i++) {
      if (exhausted.has(i)) continue;
      const { value, done } = await iterators[i]!.next();
      if (done === true) {
        exhausted.add(i);
        continue;
      }
      yield value;
    }
  }
}

/**
 * `tap` — pass-through observer for an async iterable. Useful for
 * audit / metrics without buffering the whole stream.
 */
export async function* tap<T>(
  source: AsyncIterable<T>,
  onItem: (item: T, index: number) => void,
): AsyncIterable<T> {
  let index = 0;
  for await (const item of source) {
    onItem(item, index);
    index++;
    yield item;
  }
}
