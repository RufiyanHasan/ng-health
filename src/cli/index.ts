#!/usr/bin/env node
import { runShutdownCleanups } from '../core/shutdown.js';
import { runCli } from './program.js';

// Ctrl+C or a cancelled CI job: stop Chrome and the local server before exiting.
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    process.stderr.write(`\nfe-health: received ${signal}, cleaning up…\n`);
    void runShutdownCleanups().finally(() => process.exit(code));
  });
}

const code = await runCli(process.argv.slice(2));
process.exitCode = code;
// A timed-out check may leave handles open (child processes, browsers). Exit once
// output has had a moment to flush; unref() means this never delays a clean exit.
setTimeout(() => process.exit(code), 1000).unref();
