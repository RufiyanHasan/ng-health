import pc from 'picocolors';

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  /** Raw output to stdout (reports, summaries). */
  out(msg: string): void;
}

export interface LoggerOptions {
  verbose?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

/** Diagnostics go to stderr so stdout stays clean for report output. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const line = (stream: NodeJS.WritableStream, msg: string) => stream.write(`${msg}\n`);
  return {
    info: (msg) => line(stderr, msg),
    success: (msg) => line(stderr, `${pc.green('✔')} ${msg}`),
    warn: (msg) => line(stderr, `${pc.yellow('⚠')} ${msg}`),
    error: (msg) => line(stderr, `${pc.red('✖')} ${msg}`),
    debug: (msg) => {
      if (opts.verbose) line(stderr, pc.dim(`[debug] ${msg}`));
    },
    out: (msg) => line(stdout, msg),
  };
}

export const silentLogger: Logger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  out: () => {},
};
