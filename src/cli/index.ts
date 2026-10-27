#!/usr/bin/env node
import { runCli } from './program.js';

const code = await runCli(process.argv.slice(2));
process.exitCode = code;
// A timed-out check may leave handles open (child processes, browsers). Exit once
// output has had a moment to flush; unref() means this never delays a clean exit.
setTimeout(() => process.exit(code), 1000).unref();
