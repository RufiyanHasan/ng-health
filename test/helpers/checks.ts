import { parseConfig } from '../../src/core/config/loader.js';
import type { ConfigInput } from '../../src/core/config/schema.js';
import { DEFAULT_SEVERITY_PENALTIES } from '../../src/core/config/schema.js';
import { createBaseContext } from '../../src/core/context.js';
import type { ProjectInfo } from '../../src/core/detect/index.js';
import { silentLogger } from '../../src/core/logger.js';
import type { SelectedCheck } from '../../src/core/registry.js';
import type { Check, CheckOutput, Finding } from '../../src/core/types.js';

export const fakeProject = (root = '/tmp/fake'): ProjectInfo => ({
  root,
  name: 'fake',
  packageManager: 'npm',
  angular: { declared: '^19.0.0', installed: undefined, major: 19 },
  kind: 'single-app',
  workspaceFile: undefined,
  nx: false,
  projects: [],
  defaultProject: undefined,
  ssr: false,
});

export const finding = (overrides: Partial<Finding> = {}): Finding => ({
  severity: 'medium',
  message: 'Something is off',
  fixHint: 'Fix it',
  ...overrides,
});

export function stubCheck(
  id: string,
  output: CheckOutput | (() => Promise<CheckOutput> | CheckOutput),
  extra: Partial<Check> = {},
): Check {
  return {
    id,
    name: id,
    category: id.split('/')[0]!,
    run: typeof output === 'function' ? output : () => output,
    ...extra,
  };
}

export const selected = (
  check: Check,
  settings: SelectedCheck['settings'] = {},
): SelectedCheck => ({
  check,
  settings,
});

export function baseContext(config: ConfigInput = {}, root?: string) {
  return createBaseContext(fakeProject(root), parseConfig(config), silentLogger);
}

export const runnerOpts = { severityPenalties: DEFAULT_SEVERITY_PENALTIES };
