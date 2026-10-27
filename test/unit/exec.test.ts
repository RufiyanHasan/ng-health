import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { exec, quoteForCmd } from '../../src/core/exec.js';

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
    expect(r.stdout).toBe(`${path.resolve('/')}|y`);
  });

  it('rejects when the command cannot start or is aborted', async () => {
    if (process.platform === 'win32') {
      // Bare names run through cmd.exe there, which reports a missing command as exit code 1.
      expect((await exec('definitely-not-a-command-xyz', [])).exitCode).not.toBe(0);
    } else {
      await expect(exec('definitely-not-a-command-xyz', [])).rejects.toThrow(/ENOENT/);
    }
    const controller = new AbortController();
    const p = exec(node, ['-e', 'setTimeout(() => {}, 10000)'], { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });

  it('quotes arguments for cmd.exe when a shell is needed on Windows', () => {
    expect(quoteForCmd('left-pad@^1.3.0')).toBe('"left-pad@^1.3.0"');
    expect(quoteForCmd('C:\\Program Files\\x.cmd')).toBe('"C:\\Program Files\\x.cmd"');
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
    expect(quoteForCmd('--json')).toBe('--json');
  });
});
