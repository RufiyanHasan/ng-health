/**
 * Cleanups to run if the process is interrupted (Ctrl+C, CI job cancelled). The CLI installs
 * the signal handlers; library users can call runShutdownCleanups() from their own handlers.
 */
const cleanups = new Set<() => Promise<void>>();

export function onShutdown(fn: () => Promise<void>): () => void {
  cleanups.add(fn);
  return () => void cleanups.delete(fn);
}

export async function runShutdownCleanups(): Promise<void> {
  const pending = [...cleanups];
  cleanups.clear();
  await Promise.allSettled(pending.map((fn) => fn()));
}
