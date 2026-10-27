import { describe, expect, it } from 'vitest';
import { checksFromModule, loadPlugins } from '../../src/core/plugins.js';
import { makeTempProject } from '../helpers/tmp.js';

const pluginSource = (id: string) => `export default {
  id: '${id}', name: 'Plugin', category: 'custom',
  run: () => ({ findings: [] }),
};`;

describe('plugins', () => {
  it('loads default, array and named exports from relative paths and packages', async () => {
    const dir = await makeTempProject({
      'checks/one.mjs': pluginSource('custom/one'),
      'checks/many.mjs': `import one from './one.mjs';
        export default [{ ...one, id: 'custom/two' }, { ...one, id: 'custom/three' }];`,
      'node_modules/ng-health-plugin-x/package.json': {
        name: 'ng-health-plugin-x',
        main: 'index.js',
        type: 'module',
      },
      'node_modules/ng-health-plugin-x/index.js': `export const checks = [{ id: 'x/pkg', name: 'X', category: 'x', run: () => ({ findings: [] }) }];`,
      'package.json': {},
    });
    const checks = await loadPlugins(
      ['./checks/one.mjs', `${dir}/checks/many.mjs`, 'ng-health-plugin-x'],
      dir,
      dir,
    );
    expect(checks.map((c) => c.id)).toEqual(['custom/one', 'custom/two', 'custom/three', 'x/pkg']);
  });

  it('gives a helpful error for missing or invalid plugins', async () => {
    const dir = await makeTempProject({
      'bad.mjs': 'export default { id: "x" }',
      'package.json': {},
    });
    await expect(loadPlugins(['./missing.mjs'], dir, dir)).rejects.toThrow(
      /Could not load plugin "\.\/missing\.mjs"/,
    );
    await expect(loadPlugins(['./bad.mjs'], dir, dir)).rejects.toThrow(
      /does not export a valid check/,
    );
    expect(() => checksFromModule({}, 'empty')).toThrow(/has no default export or "checks" export/);
    expect(() => checksFromModule({ default: [] }, 'empty')).toThrow(
      /exports an empty list of checks/,
    );
  });
});
