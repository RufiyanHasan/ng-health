import path from 'node:path';
import { pathExists, readJsonFile } from '../../core/fs.js';
import { defineCheck, type Finding } from '../../core/types.js';
import { readPackageJson } from '../dependencies/package-json.js';

const ESLINT_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];
const PRETTIER_FILES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
];

async function firstExisting(root: string, files: string[]): Promise<string | undefined> {
  for (const f of files) if (await pathExists(path.join(root, f))) return f;
  return undefined;
}

export default defineCheck({
  id: 'hygiene/tooling',
  name: 'Lint & format tooling',
  category: 'hygiene',
  description: 'ESLint (with angular-eslint) and Prettier are configured.',
  async run(ctx) {
    const pkg =
      (await readJsonFile<Record<string, unknown>>(path.join(ctx.root, 'package.json'))) ?? {};
    const deps = await readPackageJson(ctx);
    const all = { ...deps.dependencies, ...deps.devDependencies };
    const eslint =
      (await firstExisting(ctx.root, ESLINT_FILES)) ??
      ('eslintConfig' in pkg ? 'package.json' : undefined);
    const prettier =
      (await firstExisting(ctx.root, PRETTIER_FILES)) ??
      ('prettier' in pkg ? 'package.json' : undefined);
    const tslint = await pathExists(path.join(ctx.root, 'tslint.json'));
    const angularEslint = Object.keys(all).some(
      (d) => d === 'angular-eslint' || d.startsWith('@angular-eslint/'),
    );
    const findings: Finding[] = [];

    if (!eslint) {
      findings.push({
        severity: 'high',
        ruleId: 'no-eslint',
        message: tslint
          ? 'Only TSLint (deprecated) is configured; ESLint is missing.'
          : 'No ESLint configuration found.',
        fixHint:
          'Run "ng add angular-eslint" to add ESLint with Angular-specific rules, and run it in CI.',
        docsUrl: 'https://github.com/angular-eslint/angular-eslint',
      });
    } else if (!angularEslint) {
      findings.push({
        severity: 'medium',
        ruleId: 'no-angular-eslint',
        message:
          'ESLint is configured without angular-eslint, so Angular template and component rules are not checked.',
        file: eslint,
        fixHint: 'Run "ng add angular-eslint" and extend its recommended configs.',
        docsUrl: 'https://github.com/angular-eslint/angular-eslint',
      });
    }
    if (tslint && eslint) {
      findings.push({
        severity: 'low',
        ruleId: 'leftover-tslint',
        message: 'tslint.json is still present next to the ESLint config.',
        file: 'tslint.json',
        fixHint: 'Delete tslint.json and remove tslint/codelyzer from devDependencies.',
      });
    }
    if (!prettier) {
      findings.push({
        severity: 'low',
        ruleId: 'no-prettier',
        message: 'No Prettier configuration found.',
        fixHint:
          'Add Prettier with a shared config and check formatting in CI ("prettier --check .").',
        docsUrl: 'https://prettier.io/docs/install',
      });
    }
    return {
      findings,
      meta: { eslint: eslint ?? null, prettier: prettier ?? null, angularEslint, tslint },
    };
  },
});
