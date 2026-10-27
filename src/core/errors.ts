export const ExitCode = {
  Pass: 0,
  ThresholdFailed: 1,
  ToolError: 2,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Options for constructing an {@link NgHealthError}. */
export interface NgHealthErrorOptions {
  /** A suggestion shown under the message, e.g. how to fix the config. */
  hint?: string;
  cause?: unknown;
}

/**
 * Base class for expected, user-facing errors. The library throws these instead of exiting;
 * the CLI prints `message` and `hint` without a stack trace and exits with code 2.
 * Use `code` (or `instanceof` a subclass) to branch on the kind of error.
 */
export class NgHealthError extends Error {
  readonly code: string = 'ERR_NG_HEALTH';
  readonly hint: string | undefined;

  constructor(message: string, options?: NgHealthErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.hint = options?.hint;
  }
}

/** Invalid or missing configuration, options or baseline report. */
export class ConfigError extends NgHealthError {
  override readonly code = 'ERR_CONFIG';
}

/** A check or plugin is invalid: bad export shape, invalid or duplicate id, load failure. */
export class CheckError extends NgHealthError {
  override readonly code = 'ERR_CHECK';
}

/** The target is not an auditable Angular project (missing directory, no Angular found). */
export class ProjectError extends NgHealthError {
  override readonly code = 'ERR_PROJECT';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
