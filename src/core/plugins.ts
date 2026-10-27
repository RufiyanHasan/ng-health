import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importModule } from './config/loader.js';
import { CheckError, errorMessage } from './errors.js';
import type { Check } from './types.js';

const OPTIONAL_FIELDS: [keyof Check, string][] = [
  ['description', 'string'],
  ['kind', 'string'],
  ['exclusive', 'boolean'],
  ['timeoutMs', 'number'],
  ['enabledByDefault', 'boolean'],
];

/** Lists what is wrong with a value that should be a {@link Check}; empty if it is valid. */
export function checkProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object')
    return [`expected a check object, got ${value === null ? 'null' : typeof value}`];
  const c = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ['id', 'name', 'category'] as const) {
    if (typeof c[key] !== 'string' || !c[key]) problems.push(`"${key}" must be a non-empty string`);
  }
  if (typeof c['run'] !== 'function')
    problems.push('"run" must be a function (ctx) => { findings, score? }');
  for (const [key, type] of OPTIONAL_FIELDS) {
    if (c[key] !== undefined && typeof c[key] !== type) problems.push(`"${key}" must be a ${type}`);
  }
  if (c['kind'] !== undefined && c['kind'] !== 'static' && c['kind'] !== 'runtime') {
    problems.push('"kind" must be "static" or "runtime"');
  }
  return problems;
}

/** Accepts `export default check`, `export default [checks]`, or `export const checks = [...]`. */
export function checksFromModule(mod: Record<string, unknown>, spec: string): Check[] {
  const exported = mod['default'] ?? mod['checks'];
  if (exported === undefined) {
    throw new CheckError(`Plugin "${spec}" has no default export or "checks" export`, {
      hint: 'Export a check, or an array of checks, as the default export. See "Write a custom check" in the README.',
    });
  }
  const list = Array.isArray(exported) ? exported : [exported];
  if (!list.length) throw new CheckError(`Plugin "${spec}" exports an empty list of checks`);
  const errors = list.flatMap((item, i) => {
    const problems = checkProblems(item);
    const label = list.length > 1 ? `check #${i + 1}` : 'its check';
    return problems.length ? [`${label}: ${problems.join('; ')}`] : [];
  });
  if (errors.length) {
    throw new CheckError(`Plugin "${spec}" does not export a valid check: ${errors.join(' | ')}`, {
      hint: 'A check needs id, name, category and run(ctx). Wrap it in defineCheck() for type checking.',
    });
  }
  return list as Check[];
}

const TS_EXTENSIONS = /\.(c|m)?ts$/;

/**
 * Resolves plugin specifiers: paths ("./x.js", "/abs/x.ts") relative to `baseDir`
 * (the config file's directory), package names from the project's node_modules.
 */
export function resolvePluginSpecifier(spec: string, baseDir: string, projectRoot: string): string {
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    return pathToFileURL(path.resolve(baseDir, spec)).href;
  }
  try {
    return pathToFileURL(createRequire(path.join(projectRoot, 'package.json')).resolve(spec)).href;
  } catch {
    return spec; // let import() try (e.g. globally linked packages)
  }
}

/** Loads and validates plugin modules. TypeScript plugins are transpiled on the fly. */
export async function loadPlugins(
  specs: string[],
  baseDir: string,
  projectRoot: string,
): Promise<Check[]> {
  const checks: Check[] = [];
  for (const spec of specs) {
    const url = resolvePluginSpecifier(spec, baseDir, projectRoot);
    let mod: Record<string, unknown>;
    try {
      mod = TS_EXTENSIONS.test(url)
        ? ((await importModule(fileURLToPath(url), { default: false })) as Record<string, unknown>)
        : ((await import(url)) as Record<string, unknown>);
    } catch (err) {
      throw new CheckError(`Could not load plugin "${spec}": ${errorMessage(err)}`, { cause: err });
    }
    checks.push(...checksFromModule(mod, spec));
  }
  return checks;
}
