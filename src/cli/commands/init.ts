import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConfig } from '../../core/config/loader.js';
import {
  CONFIG_FILE_NAME,
  DEFAULT_CATEGORY_WEIGHTS,
  type ConfigInput,
} from '../../core/config/schema.js';
import { FeHealthError } from '../../core/errors.js';
import { isDirectory, pathExists } from '../../core/fs.js';
import type { Logger } from '../../core/logger.js';

export const DEFAULT_CONFIG: ConfigInput = {
  $schema: './node_modules/fe-health/schema/config.schema.json',
  checks: {},
  skip: [],
  weights: { ...DEFAULT_CATEGORY_WEIGHTS },
  thresholds: {
    minOverallScore: 70,
    maxCriticalVulnerabilities: 0,
    maxCriticalA11yViolations: 0,
  },
  ignore: ['**/node_modules/**', '**/dist/**', '**/.angular/**', '**/coverage/**'],
  runtime: { routes: ['/'], formFactor: 'mobile' },
  output: { dir: 'fe-health-report', formats: ['console', 'html'] },
};

export async function initCommand(
  dir: string,
  opts: { force?: boolean },
  logger: Logger,
): Promise<string> {
  const root = path.resolve(dir);
  if (!(await isDirectory(root))) {
    throw new FeHealthError(`Directory does not exist: ${root}`);
  }
  const file = path.join(root, CONFIG_FILE_NAME);
  if ((await pathExists(file)) && !opts.force) {
    throw new FeHealthError(`${CONFIG_FILE_NAME} already exists in ${root}`, {
      hint: 'Use --force to overwrite it.',
    });
  }
  parseConfig(DEFAULT_CONFIG); // guard: the template must always satisfy the schema
  await writeFile(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
  logger.success(`Wrote ${path.relative(process.cwd(), file) || file}`);
  return file;
}
