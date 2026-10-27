import path from 'node:path';
import type { z } from 'zod';
import { ConfigError } from '../errors.js';
import { readJsonFile } from '../fs.js';
import { CONFIG_FILE_NAME, ConfigSchema, type Config, type ConfigInput } from './schema.js';

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

/**
 * Loads the config: an inline object, an explicit file path, or `ng-health.config.json` in the
 * project root. A missing default config is fine (defaults apply); a missing explicit one is not.
 */
export async function loadConfig(
  projectRoot: string,
  source?: string | ConfigInput,
): Promise<LoadedConfig> {
  if (source !== undefined && typeof source !== 'string') {
    return { config: parseConfig(source, 'inline config'), file: undefined };
  }
  const file = source ? path.resolve(source) : path.join(projectRoot, CONFIG_FILE_NAME);
  const raw = await readJsonFile(file);
  if (raw === undefined) {
    if (source) throw new ConfigError(`Config file not found: ${file}`);
    return { config: parseConfig({}), file: undefined };
  }
  return { config: parseConfig(raw, path.basename(file)), file };
}
