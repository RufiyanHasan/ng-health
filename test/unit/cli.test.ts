import { readFile, writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runCli, VERSION } from '../../src/cli/program.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

function capture() {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += String(chunk);
      cb();
    },
  });
  return {
    stream,
    get text() {
      return text;
    },
  };
}

async function run(...args: string[]) {
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(args, { stdout: stdout.stream, stderr: stderr.stream });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

describe('ng-health CLI', () => {
  it('--version prints the package version and exits 0', async () => {
    const r = await run('--version');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  it('--help exits 0', async () => {
    const r = await run('audit', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--format <formats>');
  });

  it('unknown options are tool errors (exit 2)', async () => {
    expect((await run('audit', '--bogus')).code).toBe(2);
  });

  it('audit succeeds on an Angular project', async () => {
    const dir = await makeTempProject(angularApp());
    const r = await run('audit', dir, '--ci', '--offline', '--out', `${dir}/out`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Angular ^19.2.0');
    expect(r.stderr).toContain('single app');
  });

  it('audit exits 2 with a friendly error for a missing path', async () => {
    const r = await run('audit', '/definitely/not/here');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Project path does not exist');
  });

  it('audit exits 2 for a non-Angular project', async () => {
    const dir = await makeTempProject({ 'package.json': {} });
    const r = await run('audit', dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('No Angular project found');
    expect(r.stderr).toContain('ng-health audit <path>');
  });

  it('audit exits 2 for an invalid config or format', async () => {
    const dir = await makeTempProject(
      angularApp({ 'ng-health.config.json': { thresholds: { minOverallScore: -1 } } }),
    );
    const bad = await run('audit', dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('thresholds.minOverallScore');
    await writeFile(`${dir}/ng-health.config.json`, '{}');
    const fmt = await run('audit', dir, '--format', 'html,pdf');
    expect(fmt.code).toBe(2);
    expect(fmt.stderr).toContain('Unknown report format: pdf');
  });

  it('--verbose prints debug output', async () => {
    const dir = await makeTempProject(angularApp());
    const r = await run('audit', dir, '--verbose', '--offline', '--out', `${dir}/out`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('[debug] No config file found');
  });

  it('init writes a valid config and refuses to overwrite without --force', async () => {
    const dir = await makeTempProject({});
    expect((await run('init', dir)).code).toBe(0);
    const written = JSON.parse(await readFile(`${dir}/ng-health.config.json`, 'utf8'));
    expect(written.thresholds.minOverallScore).toBe(70);

    const again = await run('init', dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already exists');
    expect((await run('init', dir, '--force')).code).toBe(0);

    expect((await run('audit', dir, '--config', `${dir}/ng-health.config.json`)).stderr).toContain(
      'No Angular project found',
    );
  });
});
