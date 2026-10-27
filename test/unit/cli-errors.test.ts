import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/audit.js', () => ({
  runAudit: vi.fn(async () => {
    throw new TypeError('cannot read properties of undefined');
  }),
}));

const { runCli } = await import('../../src/cli/program.js');
const { NgHealthError } = await import('../../src/core/errors.js');
const { runAudit } = await import('../../src/core/audit.js');

function capture() {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += String(chunk);
      cb();
    },
  });
  return { stream, read: () => text };
}

describe('CLI error handling', () => {
  it('reports unexpected errors with exit code 2 and a --verbose hint', async () => {
    const err = capture();
    expect(await runCli(['audit', '.'], { stdout: capture().stream, stderr: err.stream })).toBe(2);
    expect(err.read()).toContain('Unexpected error: cannot read properties of undefined');
    expect(err.read()).toContain('Re-run with --verbose for details.');
  });

  it('prints stack traces in verbose mode', async () => {
    const err = capture();
    expect(
      await runCli(['audit', '.', '--verbose'], { stdout: capture().stream, stderr: err.stream }),
    ).toBe(2);
    expect(err.read()).toMatch(/\[debug\] TypeError: cannot read properties/);
  });

  it('prints the cause of tool errors in verbose mode', async () => {
    vi.mocked(runAudit).mockRejectedValueOnce(
      new NgHealthError('Config broken', { cause: new Error('root cause') }),
    );
    const err = capture();
    expect(
      await runCli(['audit', '.', '--verbose'], { stdout: capture().stream, stderr: err.stream }),
    ).toBe(2);
    expect(err.read()).toContain('Config broken');
    expect(err.read()).toMatch(/\[debug\] Error: root cause/);
  });
});
