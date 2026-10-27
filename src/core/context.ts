import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { Config } from './config/schema.js';
import type { ProjectInfo } from './detect/index.js';
import { exec } from './exec.js';
import type { Logger } from './logger.js';
import type { BaseContext } from './runner.js';

export function createBaseContext(
  project: ProjectInfo,
  config: Config,
  logger: Logger,
  overrides: Partial<BaseContext> = {},
): BaseContext {
  const cache = new Map<string, Promise<unknown>>();
  return {
    root: project.root,
    project,
    config,
    logger,
    offline: config.offline,
    build: true,
    now: () => new Date(),
    exec,
    glob: (patterns, opts) =>
      fg(patterns, {
        cwd: opts?.cwd ? path.resolve(project.root, opts.cwd) : project.root,
        ignore: config.ignore,
        onlyFiles: true,
        dot: false,
      }).then((files) => files.sort()),
    readText: (rel) => readFile(path.resolve(project.root, rel), 'utf8'),
    shared: <T>(key: string, factory: () => Promise<T>) => {
      let value = cache.get(key);
      if (!value) {
        value = factory();
        cache.set(key, value);
      }
      return value as Promise<T>;
    },
    ...overrides,
  };
}
