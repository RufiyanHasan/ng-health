import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CheckError, errorMessage } from './errors.js';
import type { Check } from './types.js';

function isCheck(value: unknown): value is Check {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Check>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.category === 'string' &&
    typeof c.run === 'function'
  );
}

/** Accepts `export default check`, `export default [checks]`, or `export const checks = [...]`. */
export function checksFromModule(mod: Record<string, unknown>, spec: string): Check[] {
  const exported = mod['default'] ?? mod['checks'];
  const list = Array.isArray(exported) ? exported : [exported];
  if (!list.length || !list.every(isCheck)) {
    throw new CheckError(`Plugin "${spec}" does not export a valid check`, {
      hint: 'Export a check (or an array of checks) as the default export. Each needs id, name, category and run(). See "Writing a custom check" in the README.',
    });
  }
  return list;
}

/**
 * Resolves plugin specifiers: paths ("./x.js", "/abs/x.js") relative to `baseDir`
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
      mod = (await import(url)) as Record<string, unknown>;
    } catch (err) {
      throw new CheckError(`Could not load plugin "${spec}": ${errorMessage(err)}`, {
        cause: err,
      });
    }
    checks.push(...checksFromModule(mod, spec));
  }
  return checks;
}
