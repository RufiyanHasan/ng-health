import path from 'node:path';
import semver from 'semver';
import { readJsonFile } from '../../core/fs.js';
import { readPackageJson } from '../dependencies/package-json.js';
import { defineCheck, type Finding } from '../../core/types.js';

interface TsConfig {
  extends?: string | string[];
  compilerOptions?: Record<string, unknown>;
  angularCompilerOptions?: Record<string, unknown>;
}

const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'alwaysStrict',
  'useUnknownInCatchVariables',
];

/** Loads a tsconfig, merging relative `extends` chains (package-based extends are ignored). */
export async function loadTsConfig(file: string, depth = 0): Promise<TsConfig | undefined> {
  const config = await readJsonFile<TsConfig>(file);
  if (!config || depth > 5) return config;
  const parents = (
    Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : []
  ).filter((e) => e.startsWith('.'));
  let merged: TsConfig = {};
  for (const parent of parents) {
    const base = await loadTsConfig(path.resolve(path.dirname(file), parent), depth + 1);
    if (base) {
      merged = {
        compilerOptions: { ...merged.compilerOptions, ...base.compilerOptions },
        angularCompilerOptions: {
          ...merged.angularCompilerOptions,
          ...base.angularCompilerOptions,
        },
      };
    }
  }
  return {
    compilerOptions: { ...merged.compilerOptions, ...config.compilerOptions },
    angularCompilerOptions: { ...merged.angularCompilerOptions, ...config.angularCompilerOptions },
  };
}

/** Installed TypeScript major, else the lowest version allowed by package.json. */
async function typescriptMajor(
  root: string,
  declared: string | undefined,
): Promise<number | undefined> {
  const installed = (
    await readJsonFile<{ version?: string }>(
      path.join(root, 'node_modules/typescript/package.json'),
    )
  )?.version;
  if (installed && semver.valid(installed)) return semver.major(installed);
  const min = declared && semver.validRange(declared) ? semver.minVersion(declared) : null;
  return min?.major;
}

export default defineCheck({
  id: 'hygiene/typescript-strict',
  name: 'Strict TypeScript',
  category: 'hygiene',
  description: 'TypeScript strict mode and Angular strict templates are enabled.',
  async run(ctx) {
    const appTsconfig = ['tsconfig.app.json', 'tsconfig.json'];
    let file: string | undefined;
    let config: TsConfig | undefined;
    for (const f of appTsconfig) {
      config = await loadTsConfig(path.join(ctx.root, f));
      if (config) {
        file = f;
        break;
      }
    }
    if (!config || !file) {
      return {
        score: 0,
        findings: [
          {
            severity: 'high',
            ruleId: 'no-tsconfig',
            message: 'No tsconfig.json found.',
            fixHint: 'Add a tsconfig.json with "strict": true.',
          },
        ],
      };
    }
    const co = config.compilerOptions ?? {};
    const aco = config.angularCompilerOptions ?? {};
    const pkg = await readPackageJson(ctx);
    const tsMajor = await typescriptMajor(
      ctx.root,
      pkg.devDependencies?.['typescript'] ?? pkg.dependencies?.['typescript'],
    );
    // TypeScript 6 enables strict by default; Angular 22 enables strictTemplates by default.
    const strict = co['strict'] === true || (co['strict'] === undefined && (tsMajor ?? 0) >= 6);
    const strictTemplates =
      aco['strictTemplates'] === true ||
      (aco['strictTemplates'] === undefined && (ctx.project.angular.major ?? 0) >= 22);
    const findings: Finding[] = [];
    if (!strict) {
      findings.push({
        severity: 'high',
        ruleId: 'strict-off',
        message: 'TypeScript strict mode is off.',
        file,
        fixHint:
          'Set "strict": true in compilerOptions; fix errors incrementally (start with strictNullChecks).',
        docsUrl: 'https://www.typescriptlang.org/tsconfig#strict',
      });
    } else {
      const disabled = STRICT_FAMILY.filter((k) => co[k] === false);
      if (disabled.length) {
        findings.push({
          severity: 'medium',
          ruleId: 'strict-partially-disabled',
          message: `strict is on but ${disabled.join(', ')} ${disabled.length === 1 ? 'is' : 'are'} disabled.`,
          file,
          fixHint: `Remove the overrides for ${disabled.join(', ')}.`,
        });
      }
    }
    if (!strictTemplates) {
      findings.push({
        severity: 'medium',
        ruleId: 'strict-templates-off',
        message: 'Angular strictTemplates is off, so template bindings are not type-checked.',
        file,
        fixHint: 'Set "strictTemplates": true in angularCompilerOptions.',
        docsUrl: 'https://angular.dev/tools/cli/template-typecheck',
      });
    }
    if (aco['strictInjectionParameters'] !== true) {
      findings.push({
        severity: 'low',
        ruleId: 'strict-injection-off',
        message: 'Angular strictInjectionParameters is off.',
        file,
        fixHint: 'Set "strictInjectionParameters": true in angularCompilerOptions.',
      });
    }
    return {
      findings,
      meta: {
        file,
        typescriptMajor: tsMajor ?? null,
        strict,
        strictTemplates,
      },
    };
  },
});
