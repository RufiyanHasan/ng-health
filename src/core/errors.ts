export const ExitCode = {
  Pass: 0,
  ThresholdFailed: 1,
  ToolError: 2,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * An expected, user-facing error. The CLI prints `message` (and `hint`, if any)
 * without a stack trace and exits with code 2.
 */
export class NgHealthError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, options?: { hint?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'NgHealthError';
    this.hint = options?.hint;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
