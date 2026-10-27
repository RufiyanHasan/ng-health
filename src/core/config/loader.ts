import path from 'node:path';
import type { z } from 'zod';
import { ConfigError, errorMessage } from '../errors.js';
import { pathExists, readJsonFile } from '../fs.js';
import { CONFIG_FILE_NAMES, ConfigSchema, type Config, type ConfigInput } from './schema.js';

export interface LoadedConfig {
  config: Config;
  /** Absolute path of the file the config came from, or undefined when defaults are used. */
  file: string | undefined;
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length ? issue.path.join('.') : '(root)';
      return `  • ${where}: ${issue.message}`;
    })
    .join('\n');
}

export function parseConfig(raw: unknown, source = 'config'): Config {
  const result = ConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(`Invalid ${source}:\n${formatZodIssues(result.error)}`, {
      hint: `See the config reference in the ng-health README, or regenerate it with "ng-health init --force".`,
    });
  }
  return result.data;
}

/** Loads TypeScript/JavaScript modules (configs, TS plugins) without a build step. */
export async function importModule(file: string, opts: { default: boolean }): Promise<unknown> {
  const { createJiti } = await import('jiti');
  // moduleCache off: re-running an audit in the same process picks up config edits.
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
    // Plugins need the real namespace (`export const checks`); interop would fake a `default`.
    interopDefault: opts.default,
  });
  return opts.default ? jiti.import(file, { default: true }) : jiti.import(file);
}

async function readConfigFile(file: string): Promise<unknown> {
  if (file.endsWith('.json')) return readJsonFile(file);
  let mod: unknown;
  try {
    mod = await importModule(file, { default: true });
  } catch (err) {
    throw new ConfigError(`Could not load ${path.basename(file)}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
  // `export default defineConfig({...})`, or a (possibly async) function returning the config.
  return typeof mod === 'function' ? await (mod as () => unknown)() : mod;
}

/**
 * Loads the config: an inline object, an explicit file path, or the first
 * `ng-health.config.{ts,mts,js,mjs,cjs,json}` in the project root. A missing default config is
 * fine (defaults apply); a missing explicit one, or two competing default files, is an error.
 */
export async function loadConfig(
  projectRoot: string,
  source?: string | ConfigInput,
): Promise<LoadedConfig> {
  if (source !== undefined && typeof source !== 'string') {
    return { config: parseConfig(source, 'inline config'), file: undefined };
  }
  let file: string | undefined;
  if (source) {
    file = path.resolve(source);
    if (!(await pathExists(file))) throw new ConfigError(`Config file not found: ${file}`);
  } else {
    const found: string[] = [];
    for (const name of CONFIG_FILE_NAMES) {
      if (await pathExists(path.join(projectRoot, name))) found.push(name);
    }
    if (found.length > 1) {
      throw new ConfigError(`Found several config files: ${found.join(', ')}`, {
        hint: 'Keep one of them (ng-health would not know which to use).',
      });
    }
    if (!found[0]) return { config: parseConfig({}), file: undefined };
    file = path.join(projectRoot, found[0]);
  }
  return { config: parseConfig(await readConfigFile(file), path.basename(file)), file };
}
