import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { auditCommand as audit } from '../../src/cli/commands/audit.js';
import { silentLogger } from '../../src/core/logger.js';
import { findChrome } from '../../src/runtime/chrome.js';
import { fixture } from '../helpers/fixtures.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

// Real Chrome + Lighthouse + axe. Skipped when no Chrome/Chromium is installed.
const chrome = await findChrome();
const runtimeOnly = { only: ['performance', 'accessibility'] };

describe.skipIf(!chrome)('runtime checks against real Chrome', { timeout: 180_000 }, () => {
  it('finds the deliberate WCAG violations in the unhealthy fixture', async () => {
    const { report, exitCode } = await audit(fixture('unhealthy'), runtimeOnly, silentLogger);
    const axe = report.checks.find((c) => c.id === 'accessibility/axe');
    expect(axe?.status).toBe('completed');
    const rules = report.findings
      .filter((f) => f.checkId === 'accessibility/axe')
      .map((f) => f.ruleId);
    expect(rules.sort()).toEqual(
      [
        'axe/button-name',
        'axe/color-contrast',
        'axe/document-title',
        'axe/html-has-lang',
        'axe/image-alt',
        'axe/link-name',
      ].sort(),
    );
    expect(axe?.meta).toMatchObject({ criticalViolations: 2, target: 'local-build' });
    expect(report.thresholds.find((t) => t.id === 'maxCriticalA11yViolations')).toMatchObject({
      passed: false,
      actual: 2,
    });
    expect(report.checks.find((c) => c.id === 'performance/lighthouse')?.status).toBe('completed');
    expect(exitCode).toBe(1);
  });

  it('passes the healthy fixture', async () => {
    const { report } = await audit(fixture('healthy'), runtimeOnly, silentLogger);
    expect(report.findings.filter((f) => f.checkId === 'accessibility/axe')).toEqual([]);
    const lh = report.checks.find((c) => c.id === 'performance/lighthouse');
    expect(lh?.status).toBe('completed');
    expect(lh?.score).toBeGreaterThanOrEqual(80);
    expect(report.categories.find((c) => c.id === 'accessibility')?.score).toBe(100);
  });

  it('stops Chrome when the CLI is interrupted with SIGTERM (e.g. a cancelled CI job)', async () => {
    const out = await makeTempProject({});
    const child = spawn(
      process.execPath,
      [
        inject('cliPath'),
        'audit',
        fixture('healthy'),
        '--only',
        'performance',
        '--verbose',
        '--out',
        out,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    const port = await new Promise<number>((resolve, reject) => {
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        const m = /listening on port (\d+)/.exec(stderr);
        if (m) resolve(Number(m[1]));
      });
      child.on('exit', () => reject(new Error(`CLI exited before Chrome started:\n${stderr}`)));
    });
    const alive = () =>
      fetch(`http://127.0.0.1:${port}/json/version`).then(
        () => true,
        () => false,
      );
    expect(await alive()).toBe(true);

    const exited = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    );
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(stderr).toContain('received SIGTERM, cleaning up');
    expect(await alive()).toBe(false);
  });

  describe('with a login script', () => {
    let server: http.Server;
    let baseUrl: string;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const authed = /session=ok/.test(req.headers.cookie ?? '');
        const page = (title: string, body: string) =>
          `<!doctype html><html lang="en"><head><title>${title}</title><link rel="icon" href="data:,"></head><body><main>${body}</main></body></html>`;
        if (req.method === 'POST' && req.url === '/login') {
          res
            .writeHead(303, {
              location: '/dashboard',
              'set-cookie': 'session=ok; Path=/; HttpOnly',
            })
            .end();
        } else if (req.url === '/login') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(
            page(
              'Login',
              '<h1>Login</h1><form method="post" action="/login"><label for="u">User</label><input id="u" name="u"><button type="submit">Sign in</button></form>',
            ),
          );
        } else if (!authed) {
          res.writeHead(302, { location: '/login' }).end();
        } else {
          res.writeHead(200, { 'content-type': 'text/html' });
          // Deliberate violation that only exists behind the login.
          res.end(
            page(
              'Dashboard',
              '<h1>Dashboard</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
            ),
          );
        }
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it('audits protected routes with the logged-in session (axe and Lighthouse)', async () => {
      const dir = await makeTempProject({
        ...angularApp(),
        'login.mjs': `export default async ({ page, baseUrl }) => {
          await page.goto(baseUrl + '/login');
          await page.fill('#u', 'demo');
          await Promise.all([page.waitForURL('**/dashboard'), page.click('button[type=submit]')]);
        };`,
      });
      const { report } = await audit(
        dir,
        {
          ...runtimeOnly,
          url: baseUrl,
          routes: ['/dashboard'],
          loginScript: path.join(dir, 'login.mjs'),
          out: path.join(dir, 'out'),
        },
        silentLogger,
      );
      const axe = report.checks.find((c) => c.id === 'accessibility/axe');
      expect(axe?.meta).toMatchObject({ target: 'url' });
      expect(report.findings.map((f) => f.ruleId)).toContain('axe/image-alt');
      const lh = report.checks.find((c) => c.id === 'performance/lighthouse');
      expect(lh?.meta).toMatchObject({ authenticated: true });
      // Lighthouse saw the dashboard (with the image), not the accessible login page.
      const routes = (
        lh?.meta as { routes: { route: string; scores: { accessibility: number } }[] }
      ).routes;
      expect(routes[0]?.scores.accessibility).toBeLessThan(100);
    });

    it('reports a failing login script as errored on both runtime checks', async () => {
      const dir = await makeTempProject({
        ...angularApp(),
        'login.mjs': `export default async () => { throw new Error('bad password'); };`,
      });
      const { report } = await audit(
        dir,
        {
          ...runtimeOnly,
          url: baseUrl,
          loginScript: path.join(dir, 'login.mjs'),
          out: path.join(dir, 'out'),
        },
        silentLogger,
      );
      for (const id of ['performance/lighthouse', 'accessibility/axe']) {
        expect(report.checks.find((c) => c.id === id)).toMatchObject({
          status: 'errored',
          reason: 'Login script login.mjs failed: bad password',
        });
      }
    });
  });
});
