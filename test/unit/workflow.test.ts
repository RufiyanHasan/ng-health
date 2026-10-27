import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { MARKDOWN_MARKER } from '../../src/reporters/markdown.js';
import { makeTempProject } from '../helpers/tmp.js';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}

const workflow = parse(
  await readFile(new URL('../../examples/github-actions/ng-health.yml', import.meta.url), 'utf8'),
) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: { audit: { steps: Step[] } };
};
const steps = workflow.jobs.audit.steps;
const nodeRequire = createRequire(import.meta.url);
const script =
  steps.find((s) => s.uses?.startsWith('actions/github-script'))?.with?.['script'] ?? '';

/** Runs the github-script step body like actions/github-script does, against a mock API. */
async function runCommentScript(
  cwd: string,
  existingComments: { id: number; body: string; user: { type: string } }[],
) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const warnings: string[] = [];
  const github = {
    paginate: async () => existingComments,
    rest: {
      issues: {
        listComments: () => undefined,
        createComment: async (args: Record<string, unknown>) =>
          void calls.push({ method: 'create', args }),
        updateComment: async (args: Record<string, unknown>) =>
          void calls.push({ method: 'update', args }),
      },
    },
  };
  const context = {
    repo: { owner: 'acme', repo: 'shop' },
    issue: { number: 42 },
    serverUrl: 'https://github.com',
    runId: 7,
  };
  const core = { warning: (m: string) => warnings.push(m) };
  const fsShim = {
    existsSync: (p: string) => fs.existsSync(path.join(cwd, p)),
    readFileSync: (p: string, enc: string) =>
      fs.readFileSync(path.join(cwd, p), enc as BufferEncoding),
  };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('github', 'context', 'core', 'require', script)(
    github,
    context,
    core,
    (m: string) => (m === 'fs' ? fsShim : nodeRequire(m)),
  );
  return { calls, warnings };
}

describe('example GitHub Actions workflow', () => {
  it('runs on PRs and main, with the permissions it needs', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request', 'push']);
    expect(workflow.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'write',
    });
  });

  it('audits in CI mode, uploads the report and comments even when the gate fails', () => {
    const auditStep = steps.find((s) => s.name === 'Audit');
    expect(auditStep?.run).toContain('audit . --ci --format html,json,md --out ng-health-report');
    expect(auditStep?.run).toContain('--baseline baseline/ng-health-report.json');
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.if).toContain('always()');
    expect(upload?.with?.['name']).toBe('ng-health-report');
    expect(steps.find((s) => s.uses?.startsWith('actions/github-script'))?.if).toContain(
      'always()',
    );
    expect(script).toContain(MARKDOWN_MARKER);
  });

  it('has syntactically valid shell steps', () => {
    for (const step of steps.filter((s) => s.run)) {
      const shell = step.run!.replace(/\$\{\{[^}]*\}\}/g, 'X');
      expect(() => execFileSync('bash', ['-n', '-c', shell])).not.toThrow();
    }
  });

  it('creates a comment, then updates it on the next run, and skips without a summary', async () => {
    const dir = await makeTempProject({
      'ng-health-report/ng-health-report.md': `${MARKDOWN_MARKER}\n## Frontend health`,
    });
    const first = await runCommentScript(dir, [
      { id: 1, body: 'unrelated', user: { type: 'User' } },
    ]);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]).toMatchObject({
      method: 'create',
      args: { owner: 'acme', repo: 'shop', issue_number: 42 },
    });
    expect(first.calls[0]!.args['body']).toContain('https://github.com/acme/shop/actions/runs/7');

    const second = await runCommentScript(dir, [
      { id: 99, body: `${MARKDOWN_MARKER} old`, user: { type: 'Bot' } },
    ]);
    expect(second.calls).toEqual([
      { method: 'update', args: expect.objectContaining({ comment_id: 99 }) },
    ]);

    const empty = await runCommentScript(await makeTempProject({}), []);
    expect(empty.calls).toEqual([]);
    expect(empty.warnings).toHaveLength(1);
  });
});

describe('repository workflows', () => {
  for (const name of ['ci.yml', 'publish.yml']) {
    it(`${name} parses and has valid shell steps`, async () => {
      const wf = parse(
        await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'),
      ) as {
        jobs: Record<string, { steps: Step[] }>;
      };
      const all = Object.values(wf.jobs).flatMap((j) => j.steps);
      expect(all.some((s) => s.run === 'npm test')).toBe(true);
      for (const step of all.filter((s) => s.run)) {
        const shell = step.run!.replace(/\$\{\{[^}]*\}\}/g, 'X');
        expect(() => execFileSync('bash', ['-n', '-c', shell])).not.toThrow();
      }
    });
  }

  it('publish verifies the release tag against package.json', async () => {
    const text = await readFile(
      new URL('../../.github/workflows/publish.yml', import.meta.url),
      'utf8',
    );
    const step = (parse(text) as { jobs: { publish: { steps: Step[] } } }).jobs.publish.steps.find(
      (s) => s.name === 'Tag matches package.json version',
    );
    const run = (tag: string) => {
      try {
        execFileSync('bash', ['-c', step!.run!], {
          env: { ...process.env, TAG: tag },
          cwd: new URL('../..', import.meta.url).pathname,
          stdio: 'pipe',
        });
        return 0;
      } catch {
        return 1;
      }
    };
    const { version } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(run(`v${version}`)).toBe(0);
    expect(run('v9.9.9')).toBe(1);
  });
});
