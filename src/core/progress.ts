import ora, { type Ora } from 'ora';

export interface Progress {
  /** False when output is a no-op (CI, piped output, verbose). */
  readonly active: boolean;
  start(text: string): void;
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

const noop: Progress = {
  active: false,
  start: () => {},
  update: () => {},
  succeed: () => {},
  fail: () => {},
  stop: () => {},
};

/** A spinner on interactive terminals; a no-op in CI, when piped, or when disabled. */
export function createProgress(
  enabled: boolean,
  stream: NodeJS.WriteStream = process.stderr,
): Progress {
  if (!enabled || !stream.isTTY) return noop;
  let spinner: Ora | undefined;
  return {
    active: true,
    start: (text) => {
      spinner = ora({ text, stream }).start();
    },
    update: (text) => {
      if (spinner) spinner.text = text;
    },
    succeed: (text) => spinner?.succeed(text),
    fail: (text) => spinner?.fail(text),
    stop: () => spinner?.stop(),
  };
}
