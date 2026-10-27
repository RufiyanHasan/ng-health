#!/usr/bin/env node
import { runCli } from './program.js';

// Ctrl+C or a cancelled CI job: cancel the audit so it stops Chrome and the local server,
// then exit with the conventional code (128 + signal number).
const controller = new AbortController();
let signalExitCode: number | undefined;
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    process.stderr.write(`\nng-health: received ${signal}, cleaning up…\n`);
    signalExitCode = code;
    controller.abort(new Error(`Received ${signal}`));
    // If cleanup hangs, don't hang with it.
    setTimeout(() => process.exit(code), 10_000).unref();
  });
}

const result = await runCli(process.argv.slice(2), {}, controller.signal);
const code = signalExitCode ?? result;
process.exitCode = code;
// A timed-out check may leave handles open (child processes, browsers). Exit once
// output has had a moment to flush; unref() means this never delays a clean exit.
setTimeout(() => process.exit(code), 1000).unref();
