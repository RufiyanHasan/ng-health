import { describe, expect, it } from 'vitest';
import { exec } from '../../src/core/exec.js';

const node = process.execPath;

describe('exec', () => {
  it('captures stdout, stderr and a non-zero exit code without throwing', async () => {
    const r = await exec(node, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ]);
    expect(r).toEqual({ stdout: 'out', stderr: 'err', exitCode: 3 });
  });

  it('passes cwd and env', async () => {
    const r = await exec(
      node,
      ['-e', 'process.stdout.write(process.cwd() + "|" + process.env.FE_X)'],
      {
        cwd: '/',
        env: { FE_X: 'y' },
      },
    );
    expect(r.stdout).toBe('/|y');
  });

  it('rejects when the command cannot start or is aborted', async () => {
    await expect(exec('definitely-not-a-command-xyz', [])).rejects.toThrow(/ENOENT/);
    const controller = new AbortController();
    const p = exec(node, ['-e', 'setTimeout(() => {}, 10000)'], { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
