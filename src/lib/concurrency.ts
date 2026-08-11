// Bounded-concurrency worker pool - unlike a naive "batch of N, await all,
// next batch of N" loop, this starts a new item the instant a slot frees up
// rather than waiting for the slowest item in each fixed-size batch, and
// (via `onResult`) can report each result the moment it's ready instead of
// only after every item has finished. That's what makes true progressive
// streaming possible instead of a compute-everything-then-dump-it-all.
// A single item failing (e.g. one bad R2 object) doesn't abort the rest -
// matches the old Promise.allSettled-based batching's tolerance, just
// without waiting for an entire batch to settle before starting the next.
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult?: (result: R, item: T, index: number) => void,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index]!;
      try {
        const result = await fn(item, index);
        results[index] = result;
        onResult?.(result, item, index);
      } catch (error) {
        console.warn(`[mapConcurrent] item ${index} failed:`, error instanceof Error ? error.message : error);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
