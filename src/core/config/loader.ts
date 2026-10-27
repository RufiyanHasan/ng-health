import path from 'node:path';
import type { z } from 'zod';
import { NgHealthError } from '../errors.js';
import { readJsonFile } from '../fs.js';
import { CONFIG_FILE_NAME, ConfigSchema, type Config } from './schema.js';

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
    throw new NgHealthError(`Invalid ${source}:\n${formatZodIssues(result.error)}`, {
      hint: `See the config reference in the ng-health README, or regenerate it with "ng-health init --force".`,
    });
  }
  return result.data;
}

/**
 * Loads the config from an explicit path, or from ng-health.config.json in the project root.
 * A missing default config is fine (defaults apply); a missing explicit config is an error.
 */
export async function loadConfig(
  projectRoot: string,
  explicitPath?: string,
): Promise<LoadedConfig> {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(projectRoot, CONFIG_FILE_NAME);
  const raw = await readJsonFile(file);
  if (raw === undefined) {
    if (explicitPath) throw new NgHealthError(`Config file not found: ${file}`);
    return { config: parseConfig({}), file: undefined };
  }
  return { config: parseConfig(raw, path.basename(file)), file };
}
