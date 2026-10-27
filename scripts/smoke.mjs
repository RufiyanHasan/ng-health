#!/usr/bin/env node
// npm run smoke: validates the publishable package exactly as a user receives it.
//
//   1. build, then check `npm pack` contents (dist, README.md, LICENSE only) and size
//   2. pack the tarball and install it into a fresh consumer project
//   3. CLI:     `npx ng-health audit .` inside a scratch Angular app (with a custom plugin)
//   4. Library: a TypeScript script importing from 'ng-health' type-checks (and a misuse
//               does not), then runs
//
// Needs network access for `npm install`. Pass --keep to keep the temp folder for inspection.
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const keep = process.argv.includes('--keep');
const MAX_PACKED_BYTES = 400_000;
const MAX_UNPACKED_BYTES = 1_500_000;

function run(cmd, args, { cwd = repo, allowFail = false } = {}) {
  // npm/npx are .cmd shims on Windows and need a shell there.
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && !allowFail) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`,
    );
  }
  return res;
}

let failures = 0;
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(
      `✔ ${name}${detail ? ` — ${detail}` : ''} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  } catch (err) {
    failures++;
    console.log(
      `✖ ${name}\n  ${String(err instanceof Error ? err.message : err)
        .split('\n')
        .join('\n  ')}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const work = await mkdtemp(path.join(tmpdir(), 'ng-health-smoke-'));
const app = path.join(work, 'app');
let tarball;

try {
  await step('build', () => void run('npm', ['run', 'build']));

  await step('npm pack contents', () => {
    const [info] = JSON.parse(run('npm', ['pack', '--dry-run', '--json']).stdout);
    const files = info.files.map((f) => f.path);
    const unexpected = files.filter(
      (f) => !/^(package\.json|README\.md|LICENSE|dist\/.+)$/.test(f),
    );
    assert(unexpected.length === 0, `unexpected files in package: ${unexpected.join(', ')}`);
    for (const required of [
      'README.md',
      'LICENSE',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/cli/index.js',
    ]) {
      assert(files.includes(required), `package is missing ${required}`);
    }
    assert(
      info.size < MAX_PACKED_BYTES,
      `packed size ${info.size} B exceeds ${MAX_PACKED_BYTES} B`,
    );
    assert(
      info.unpackedSize < MAX_UNPACKED_BYTES,
      `unpacked size ${info.unpackedSize} B exceeds ${MAX_UNPACKED_BYTES} B`,
    );
    return `${files.length} files, ${(info.size / 1024).toFixed(0)} kB packed`;
  });

  await step('pack tarball', () => {
    const [info] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work]).stdout);
    tarball = path.join(work, info.filename);
    return info.filename;
  });

  await step('install tarball into a fresh project', async () => {
    await writeFile(
      path.join(work, 'package.json'),
      JSON.stringify({ name: 'smoke-consumer', private: true, type: 'module' }),
    );
    const ts = pkg.devDependencies.typescript;
    const types = pkg.devDependencies['@types/node'];
    run(
      'npm',
      ['install', tarball, `typescript@${ts}`, `@types/node@${types}`, '--no-audit', '--no-fund'],
      { cwd: work },
    );
    return `typescript@${ts}`;
  });

  await step('scratch Angular app with a custom plugin', async () => {
    await cp(path.join(repo, 'test/fixtures/unhealthy'), app, { recursive: true });
    const config = JSON.parse(await readFile(path.join(app, 'ng-health.config.json'), 'utf8'));
    config.plugins = ['./checks/todo-comments.mjs'];
    await writeFile(path.join(app, 'ng-health.config.json'), JSON.stringify(config, null, 2));
    // The README/example plugin, importing from the installed package.
    await cp(
      path.join(repo, 'examples/custom-check/checks/todo-comments.mjs'),
      path.join(app, 'checks/todo-comments.mjs'),
    );
    const main = path.join(app, 'src/main.ts');
    await writeFile(main, `${await readFile(main, 'utf8')}// TODO: remove before release\n`);
  });

  // The app sits inside the consumer project: `--prefix ..` makes npx use the installed
  // tarball (not the registry) while the audit runs on `.`, the app itself.
  const npxArgs = (args) => ['--prefix', work, 'ng-health', ...args];

  await step('CLI: npx ng-health --version', () => {
    const version = run('npx', npxArgs(['--version']), { cwd: app }).stdout.trim();
    assert(version === pkg.version, `expected ${pkg.version}, got ${version}`);
    return version;
  });

  await step('CLI: npx ng-health audit . (end to end)', async () => {
    const out = path.join(work, 'out');
    const res = run('npx', npxArgs(['audit', '.', '--format', 'html,json', '--out', out]), {
      cwd: app,
      allowFail: true,
    });
    assert(
      res.status === 1,
      `expected exit code 1 (quality gate fails on the unhealthy app), got ${res.status}\n${res.stderr}`,
    );
    const report = JSON.parse(await readFile(path.join(out, 'ng-health-report.json'), 'utf8'));
    assert(
      report.schemaVersion === '1.0' && report.tool.name === 'ng-health',
      'unexpected report header',
    );
    assert(
      report.checks.every((c) => c.status !== 'errored'),
      `errored checks: ${report.checks
        .filter((c) => c.status === 'errored')
        .map((c) => `${c.id}: ${c.reason}`)
        .join('; ')}`,
    );
    const html = await readFile(path.join(out, 'ng-health-report.html'), 'utf8');
    assert(html.startsWith('<!doctype html>'), 'HTML report missing');
    const plugin = report.checks.find((c) => c.id === 'custom/todo-comments');
    assert(plugin?.status === 'completed', 'custom plugin from the config did not run');
    assert(
      report.findings.some((f) => f.checkId === 'custom/todo-comments' && f.file === 'src/main.ts'),
      'plugin finding missing',
    );
    return `score ${report.score.overall}, ${report.findings.length} findings, plugin picked up`;
  });

  await step('library: TypeScript usage type-checks', async () => {
    await writeFile(
      path.join(work, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2023',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          verbatimModuleSyntax: true,
          erasableSyntaxOnly: true,
          types: ['node'],
        },
        files: ['use-library.ts'],
      }),
    );
    await writeFile(
      path.join(work, 'use-library.ts'),
      `import { audit, generateReport, NgHealthError, type AuditResult, type Finding } from 'ng-health';

const result: AuditResult = await audit('./app', { skip: ['performance', 'accessibility'], offline: true });
const plugin: Finding[] = result.findings.filter((f) => f.checkId === 'custom/todo-comments');
const markdown: string = generateReport(result, 'md');
try {
  await audit('./missing-dir');
} catch (err) {
  if (!(err instanceof NgHealthError) || err.code !== 'ERR_PROJECT') throw err;
}
console.log(JSON.stringify({ score: result.score.overall, passed: result.passed, plugin: plugin.length, md: markdown.length }));
`,
    );
    run(path.join(work, 'node_modules/.bin/tsc'), ['-p', work], { cwd: work });
  });

  await step('library: misuse is a type error (types are real, not any)', async () => {
    await writeFile(
      path.join(work, 'misuse.ts'),
      `import { audit, generateReport } from 'ng-health';
await audit(42);
generateReport(await audit('.'), 'pdf');
`,
    );
    // Own tsconfig: TypeScript 6 refuses CLI file lists next to an existing tsconfig.json.
    const tsconfig = JSON.parse(await readFile(path.join(work, 'tsconfig.json'), 'utf8'));
    await writeFile(
      path.join(work, 'tsconfig.misuse.json'),
      JSON.stringify({ ...tsconfig, files: ['misuse.ts'] }),
    );
    const res = run(
      path.join(work, 'node_modules/.bin/tsc'),
      ['-p', path.join(work, 'tsconfig.misuse.json')],
      {
        cwd: work,
        allowFail: true,
      },
    );
    const errors = (res.stdout.match(/error TS2345/g) ?? []).length;
    assert(
      res.status !== 0 && errors === 2,
      `expected 2 TS2345 errors, got exit ${res.status}:\n${res.stdout}`,
    );
  });

  await step('library: runs (import { audit } from "ng-health")', () => {
    const res = run(process.execPath, ['use-library.ts'], { cwd: work });
    const out = JSON.parse(res.stdout.trim().split('\n').at(-1));
    assert(
      out.passed === false && out.plugin === 1 && out.md > 0,
      `unexpected output: ${res.stdout}`,
    );
    return `score ${out.score}, plugin findings ${out.plugin}`;
  });
} finally {
  if (keep) console.log(`kept ${work}`);
  else await rm(work, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures} smoke step(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: all good');
