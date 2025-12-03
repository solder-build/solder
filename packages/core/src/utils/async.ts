/**
 * Executes an async function on each item in an array with controlled concurrency.
 * Results are returned in the same order as the input items.
 * 
 * @param items - Array of items to process
 * @param fn - Async function to execute on each item
 * @param concurrency - Maximum number of concurrent operations
 * @returns Promise that resolves to an array of results in the same order as input
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const resultMap = new Map<number, R>();
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item !== undefined) {
        const result = await fn(item);
        resultMap.set(idx, result);
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  // Reconstruct results in order
  for (let j = 0; j < items.length; j++) {
    const result = resultMap.get(j);
    if (result !== undefined) {
      results.push(result);
    }
  }
  return results;
}

