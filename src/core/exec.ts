import { spawn } from 'node:child_process';
import path from 'node:path';

/** Options for `ctx.exec`. */
export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Max bytes buffered per stream (default 64 MB). */
  maxBuffer?: number;
}

/** Result of `ctx.exec`: captured output and the exit code (non-zero codes are returned, not thrown). */
export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code; many tools (npm outdated/audit) exit non-zero on findings. */
  exitCode: number;
}

/** Runs a command without a shell; available to checks as `ctx.exec`. */
export type ExecFn = (command: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/**
 * Runs a command without a shell. Rejects only if the process cannot be started or is
 * aborted; a non-zero exit code is returned, not thrown.
 */
export const exec: ExecFn = (command, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const maxBuffer = opts.maxBuffer ?? 64 * 1024 * 1024;
    const shell = needsShell(command);
    const child = spawn(
      shell ? quoteForCmd(command) : command,
      shell ? args.map(quoteForCmd) : args,
      {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        signal: opts.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxBuffer) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < maxBuffer) stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });

/**
 * On Windows, npm/pnpm/ng are `.cmd` shims, which Node only runs through a shell. Executables
 * given by absolute path (e.g. node itself) don't need one.
 */
function needsShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return /\.(cmd|bat)$/i.test(command) || !path.isAbsolute(command);
}

/** Quotes an argument for cmd.exe; `^`, `&`, `|`, `<`, `>`, `%` and spaces are special there. */
export function quoteForCmd(arg: string): string {
  return /[\s^&|<>()%!"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
