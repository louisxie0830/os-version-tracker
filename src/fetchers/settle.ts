/**
 * Runs the upstream requests behind a composite source and decides whether the source is healthy:
 * partial results are fine (individual failures are logged), but if no upstream produced usable data
 * the whole source fails, so fetchAllVersions() reports it as failing instead of as an empty success.
 */
export interface SettledSources<T> {
  values: Map<string, T>;
  failures: Array<{ name: string; error: Error }>;
}

export async function settleSources<T>(
  label: string,
  tasks: ReadonlyArray<readonly [name: string, run: () => Promise<T>]>,
  isUsable: (value: T) => boolean = () => true,
): Promise<SettledSources<T>> {
  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const values = new Map<string, T>();
  const failures: SettledSources<T>['failures'] = [];

  results.forEach((r, i) => {
    const name = tasks[i][0];
    if (r.status === 'rejected') {
      failures.push({ name, error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) });
    } else if (!isUsable(r.value)) {
      failures.push({ name, error: new Error('returned no usable data') });
    } else {
      values.set(name, r.value);
    }
  });

  for (const f of failures) console.warn(`[${label}] ${f.name} failed (${f.error.message})`);
  if (!values.size) {
    throw new Error(`${label}: every upstream failed – ${failures.map(f => `${f.name}: ${f.error.message}`).join('; ')}`);
  }
  return { values, failures };
}
