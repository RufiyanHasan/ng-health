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
    repo: { owner: 'example-org', repo: 'shop' },
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
      args: { owner: 'example-org', repo: 'shop', issue_number: 42 },
    });
    expect(first.calls[0]!.args['body']).toContain(
      'https://github.com/example-org/shop/actions/runs/7',
    );

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
  const load = async (name: string) =>
    parse(await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<
        string,
        { 'runs-on': string; strategy?: { matrix: { os: string[] } }; steps: Step[] }
      >;
    };

  for (const name of ['ci.yml', 'release.yml']) {
    it(`${name} runs lint, tests and build, with valid shell steps`, async () => {
      const wf = await load(name);
      const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run));
      expect(runs).toEqual(
        expect.arrayContaining([
          'npm ci',
          'npm run lint',
          'npm test',
          'npm run build',
          'npm run smoke',
        ]),
      );
      for (const run of runs.filter((r): r is string => Boolean(r))) {
        expect(() =>
          execFileSync('bash', ['-n', '-c', run.replace(/\$\{\{[^}]*\}\}/g, 'X')]),
        ).not.toThrow();
      }
    });
  }

  it('ci.yml covers Ubuntu and Windows on Node LTS', async () => {
    const wf = await load('ci.yml');
    expect(Object.keys(wf.on)).toEqual(['push', 'pull_request']);
    expect(wf.jobs['verify']?.strategy?.matrix.os).toEqual(['ubuntu-latest', 'windows-latest']);
    const setup = wf.jobs['verify']?.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
    expect(setup?.with?.['node-version']).toBe('lts/*');
  });

  it('release.yml versions with Changesets and publishes with provenance using NPM_TOKEN', async () => {
    const wf = await load('release.yml');
    expect(wf.on).toEqual({ push: { branches: ['main'] } });
    expect(wf.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      'id-token': 'write',
    });
    const step = wf.jobs['release']?.steps.find((s) => s.uses?.startsWith('changesets/action@'));
    expect(step?.with).toMatchObject({
      'version-script': 'npm run version-packages',
      'publish-script': 'npm run release',
    });
    const env = (step as Step & { env?: Record<string, string> }).env;
    expect(env).toEqual({
      NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}',
      NPM_CONFIG_PROVENANCE: 'true',
    });
    const { scripts } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    expect(scripts['version-packages']).toBe('changeset version');
    expect(scripts['release']).toBe('npm run build && changeset publish');
  });
});
