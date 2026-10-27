# ng-health

[![npm version](https://img.shields.io/npm/v/ng-health.svg)](https://www.npmjs.com/package/ng-health)
[![CI](https://github.com/OWNER/ng-health/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/ng-health/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ng-health.svg)](LICENSE)
[![node](https://img.shields.io/node/v/ng-health.svg)](https://nodejs.org)

Audit an Angular codebase and get a **scored, actionable health report**. It covers
dependencies, bundle size, Angular anti-patterns, code hygiene, Lighthouse performance and
WCAG accessibility. Use it as a **CLI**, a **library**, or a **CI quality gate**.

ng-health runs entirely on your machine. It never uploads code or reports and has no telemetry.
The only network traffic goes to your npm registry (`npm outdated`/`audit`/`view`), and
`--offline` turns that off.

<!-- Screenshot: replace OWNER once the repository is public. -->

![Sample HTML report](https://raw.githubusercontent.com/OWNER/ng-health/main/docs/report-screenshot.png)

## Contents

- [Quick start](#quick-start)
- [Commands and flags](#commands-and-flags)
- [Use as a library](#use-as-a-library)
- [What it checks](#what-it-checks)
- [Scoring](#scoring)
- [Configuration](#configuration)
- [Reports](#reports)
- [Write a custom check](#write-a-custom-check)
- [CI setup](#ci-setup)
- [Troubleshooting](#troubleshooting)

## Quick start

Requires **Node.js 24 or later** (current LTS).

```bash
cd my-angular-app
npx ng-health audit .
```

ng-health first detects your setup: the Angular version, package manager (npm, pnpm, yarn or
bun), workspace layout, SSR and Nx. It then runs a production build (or reuses `dist/` with
`--no-build`), runs every check, prints a summary and writes
`ng-health-report/ng-health-report.html`.

```bash
npm install --save-dev ng-health    # pin it in the project
npx ng-health init                  # optional: write ng-health.config.json with the defaults

npx ng-health audit . --format html,json --out reports            # reports into ./reports
npx ng-health audit . --no-build --skip performance,accessibility --offline   # quick static pass
npx ng-health audit . --url https://staging.example.com --routes /,/orders --login-script ./login.mjs
```

The runtime checks (Lighthouse and axe) need **Chrome or Chromium**. An installed Google Chrome
is found automatically. Otherwise run `npx playwright install chromium` or set `CHROME_PATH`.
Without a browser those two checks are skipped, and the report says so.

## Commands and flags

| Command                    | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `ng-health audit [path]`   | Audit the Angular project at `path` (default `.`).                  |
| `ng-health init [path]`    | Write `ng-health.config.json` with defaults (`--force` overwrites). |
| `ng-health --version`      | Print the version.                                                  |
| `ng-health help [command]` | Show help.                                                          |

`audit` flags:

| Flag                     | Description                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `-f, --format <formats>` | `console`, `html`, `json`, `md`. Repeatable or comma-separated. Default: `console,html` (from config). |
| `-o, --out <dir>`        | Output directory for report files. Default: `ng-health-report`.                                        |
| `--only <checks>`        | Run only these check ids or categories, e.g. `--only angular,bundle/size`.                             |
| `--skip <checks>`        | Skip these check ids or categories, e.g. `--skip performance,accessibility`.                           |
| `-c, --config <file>`    | Config file (`.ts`, `.mts`, `.js`, `.mjs`, `.cjs` or `.json`). Default: `<path>/ng-health.config.*`.   |
| `--ci`                   | CI mode: no spinner, Markdown summary on stdout, always writes the `.md` report, GitHub annotations.   |
| `--url <url>`            | Audit a running app with the runtime checks instead of serving the local build.                        |
| `--routes <routes>`      | Routes for Lighthouse and axe, comma-separated. Default: `/`.                                          |
| `--login-script <file>`  | Module that logs in before the runtime checks (see [Auth-protected routes](#auth-protected-routes)).   |
| `--baseline <file>`      | A previous JSON report: adds score deltas and new/resolved findings.                                   |
| `--no-build`             | Don't run `ng build`; reuse the existing build output.                                                 |
| `--offline`              | Never touch the network (skips `npm outdated`/`audit`/`view`).                                         |
| `--verbose`              | Debug output, including per-check timings and stack traces.                                            |

**Exit codes**:

| Code          | Meaning                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `0`           | All thresholds passed.                                                      |
| `1`           | A threshold failed (quality gate).                                          |
| `2`           | Tool error: bad flags or config, not an Angular project, unwritable output. |
| `130` / `143` | Interrupted (SIGINT / SIGTERM). Chrome and the local server are cleaned up. |

A check that crashes or times out never crashes the audit. It's reported as **errored** and
left out of the score.

## Use as a library

Everything the CLI does is available as a typed API. The library **never prints, writes
files or exits the process**: it returns a result and throws typed errors.

```ts
import { writeFile } from 'node:fs/promises';
import { audit, generateReport, ConfigError, type AuditResult } from 'ng-health';

try {
  const result: AuditResult = await audit('./my-app', {
    skip: ['performance', 'accessibility'], // no browser needed
    offline: true,
    onProgress: (event) => {
      if (event.type === 'check-finished')
        console.log(`${event.done}/${event.total} ${event.checkId}`);
    },
  });

  console.log(result.score.overall, result.score.grade, result.passed);
  for (const fix of result.topFixes.slice(0, 3))
    console.log(fix.severity, fix.message, '→', fix.fixHint);

  await writeFile('report.html', generateReport(result, 'html')); // 'html' | 'json' | 'md'
} catch (err) {
  if (err instanceof ConfigError) console.error('Fix the config:', err.message, err.hint);
  else throw err;
}
```

| Export                                                       | Description                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `audit(path, options?)`                                      | Runs the audit and resolves to an `AuditResult` (scores, findings, top fixes, thresholds, `passed`). |
| `generateReport(result, format)`                             | Renders `'html'`, `'json'` (schema v1) or `'md'` and returns a string.                               |
| `defineConfig(config)`                                       | Typed helper for `ng-health.config.ts`.                                                              |
| `defineCheck(check)` / `skipCheck(reason)`                   | Write a custom check (see below).                                                                    |
| `NgHealthError`, `ConfigError`, `CheckError`, `ProjectError` | Typed errors, each with a `code` (`ERR_CONFIG`, `ERR_CHECK`, `ERR_PROJECT`).                         |
| `REPORT_SCHEMA_VERSION`                                      | Version of the JSON report schema (`1.0`).                                                           |

`AuditOptions` fields:

- `config`: a path, or an inline config object
- `only`, `skip`
- `baseline`: a path, or a previous `AuditResult`
- `url`, `routes`, `loginScript`
- `build`, `offline`
- `signal`: an `AbortSignal` to cancel; Chrome and the server are cleaned up
- `onProgress`
- `logger`: receives debug output

All types are exported: `AuditResult`, `AuditOptions`, `Finding`, `Check`, `CheckContext`,
`Config`, `Severity`, `Category` and more.

## What it checks

| Check id                       | Category      | What it reports                                                                                                                                                                          | Options (`checks.<id>.options`)                          |
| ------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `dependencies/angular-version` | dependencies  | Angular major vs the latest release and its support window (active / LTS / EOL)                                                                                                          |                                                          |
| `dependencies/outdated`        | dependencies  | Major / minor / patch gaps of direct dependencies; TypeScript and Angular-lockstep packages (`@ngrx/*`, `@angular-architects/*`, angular-eslint) are judged against your Angular version |                                                          |
| `dependencies/vulnerabilities` | dependencies  | `npm`/`pnpm audit` results by severity, with the fix for each                                                                                                                            |                                                          |
| `dependencies/deprecated`      | dependencies  | Deprecated packages (npm registry plus a built-in list: tslint, protractor…)                                                                                                             |                                                          |
| `bundle/size`                  | bundle        | Initial/lazy sizes vs `angular.json` budgets, the 10 largest modules                                                                                                                     | `build`, `maxLazyChunkKb` (250), `project`, `outputPath` |
| `angular/onpush`               | angular       | Components without OnPush (or opting out with `Eager` on Angular 22+)                                                                                                                    |                                                          |
| `angular/template-calls`       | angular       | Method calls in template bindings (zero-argument signal reads are fine)                                                                                                                  |                                                          |
| `angular/subscriptions`        | angular       | `subscribe()` without `takeUntilDestroyed`/`takeUntil`/`first`/`DestroyRef`/unsubscribe                                                                                                  |                                                          |
| `angular/control-flow`         | angular       | `*ngIf`/`*ngFor`/`ngSwitch` instead of `@if`/`@for`/`@switch` (Angular 17+)                                                                                                              |                                                          |
| `angular/standalone`           | angular       | NgModule-declared components (Angular 15+)                                                                                                                                               |                                                          |
| `angular/inject-function`      | angular       | Constructor injection where `inject()` is the project's convention                                                                                                                       | `prefer`: `auto` \| `inject` \| `constructor`            |
| `angular/any-usage`            | angular       | Explicit `any` per file; the score is based on `any` per 1,000 lines                                                                                                                     | `maxPerFile` (10)                                        |
| `angular/large-components`     | angular       | Components (class + template) over a line limit                                                                                                                                          | `maxLoc` (400)                                           |
| `hygiene/tooling`              | hygiene       | ESLint with angular-eslint, Prettier, leftover TSLint                                                                                                                                    |                                                          |
| `hygiene/typescript-strict`    | hygiene       | `strict`, `strictTemplates`, `strictInjectionParameters` (aware of the TS 6 / Angular 22 defaults)                                                                                       |                                                          |
| `hygiene/tests`                | hygiene       | Share of components/services/directives/pipes with a spec file                                                                                                                           | `targetRatio` (0.8)                                      |
| `hygiene/coverage`             | hygiene       | Line coverage from `coverage/**/coverage-summary.json` or `lcov.info`                                                                                                                    | `targetPct` (80)                                         |
| `performance/lighthouse`       | performance   | Lighthouse performance, best practices and SEO per route, plus Core Web Vitals                                                                                                           |                                                          |
| `accessibility/axe`            | accessibility | WCAG A/AA violations per rule, with the affected selectors                                                                                                                               |                                                          |

A check without data is **skipped** with a reason, for example "No coverage report found",
"Offline mode" or "Chromium not available". Skipped and errored checks don't count towards
the score.

## Scoring

- **Check score (0–100):** checks with a natural ratio score themselves (share of components with
  OnPush, Lighthouse scores, initial bundle vs budget). Other checks start at 100 and lose
  points per finding: critical −25, high −10, medium −4, low −1 (`severityPenalties`).
- **Category score:** the weighted mean of its checks' scores (`checks.<id>.weight`, default 1).
- **Overall score:** the weighted mean of the category scores. Defaults: dependencies 20,
  bundle 15, angular 20, hygiene 15, performance 15, accessibility 15; plugin categories 10.
  Categories without a completed check are left out and the remaining weights rebalanced.
- **Grade:** A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F.
- **Top 10 fixes:** findings with the same check, rule and remedy are grouped into one fix,
  ranked by severity penalty × category weight × (1 + log₂ occurrences).

## Configuration

Configuration is optional. ng-health looks for `ng-health.config.ts`, `.mts`, `.js`, `.mjs`,
`.cjs` or `.json` in the project root, in that order. Two of them at once is an error.
`ng-health init` writes a JSON one. The config is validated on load, and errors name the exact
field.

```ts
// ng-health.config.ts
import { defineConfig } from 'ng-health';

export default defineConfig({
  // Per check id or category: false disables, or { enabled, weight, timeoutMs, options }
  checks: {
    'angular/large-components': { options: { maxLoc: 300 } },
    'dependencies/outdated': { weight: 2 },
    accessibility: false,
  },
  skip: ['hygiene/coverage'],
  weights: { bundle: 25 },
  thresholds: {
    minOverallScore: 75,
    minCategoryScores: { accessibility: 90 },
    maxInitialBundleKb: 500,
    maxCriticalVulnerabilities: 0,
    maxCriticalA11yViolations: 0,
    failOnSeverity: 'critical',
  },
  runtime: { routes: ['/', '/products'], formFactor: 'desktop' },
  plugins: ['./checks/todo-comments.mjs'],
});
```

JSON configs get editor autocomplete with
`"$schema": "./node_modules/ng-health/dist/schema/config.schema.json"`.

| Key                   | Default                                              | Description                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks`              | `{}`                                                 | Per check id or category: `false`, `true` (enable an opt-in check), or `{ enabled, weight, timeoutMs, options }`. Check-level settings override category-level ones.                                                     |
| `only`                | all                                                  | Run only these check ids or categories.                                                                                                                                                                                  |
| `skip`                | `[]`                                                 | Skip these check ids or categories (merged with `--skip`).                                                                                                                                                               |
| `weights`             | see [Scoring](#scoring)                              | Category weights for the overall score, merged over the defaults.                                                                                                                                                        |
| `severityPenalties`   | `critical 25, high 10, medium 4, low 1`              | Points a finding costs in checks without their own score.                                                                                                                                                                |
| `thresholds`          | `minOverallScore: 70, maxCriticalVulnerabilities: 0` | Quality gate; any failure makes `passed` false (CLI exit 1). Keys: `minOverallScore`, `minCategoryScores`, `maxInitialBundleKb`, `maxCriticalVulnerabilities`, `maxCriticalA11yViolations` (elements), `failOnSeverity`. |
| `ignore`              | `node_modules`, `dist`, `.angular`, `coverage`       | Globs excluded from source analysis.                                                                                                                                                                                     |
| `plugins`             | `[]`                                                 | Custom check modules: paths relative to the config file (`.js`, `.mjs` or `.ts`), or package names.                                                                                                                      |
| `output.dir`          | `ng-health-report`                                   | CLI report directory (`--out` overrides).                                                                                                                                                                                |
| `output.formats`      | `["console", "html"]`                                | CLI report formats (`--format` overrides).                                                                                                                                                                               |
| `runtime.url`         | serve the local build                                | Audit a running app (`--url` overrides).                                                                                                                                                                                 |
| `runtime.routes`      | `["/"]`                                              | Routes for Lighthouse and axe (`--routes` overrides).                                                                                                                                                                    |
| `runtime.loginScript` | none                                                 | Login module, relative to the config file (`--login-script` overrides).                                                                                                                                                  |
| `runtime.chromePath`  | auto-detect                                          | Chrome/Chromium executable (or the `CHROME_PATH` environment variable).                                                                                                                                                  |
| `runtime.formFactor`  | `mobile`                                             | Lighthouse emulation: `mobile` or `desktop`.                                                                                                                                                                             |
| `runtime.axeTags`     | `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`       | axe-core rule tags.                                                                                                                                                                                                      |
| `offline`             | `false`                                              | Never touch the network (`--offline`).                                                                                                                                                                                   |

### Auth-protected routes

Give a login script and the runtime checks audit routes as a logged-in user. The session
carries over to both axe and Lighthouse. If the script throws, both runtime checks are reported
as errored.

```js
// login.mjs
export default async function login({ page, baseUrl }) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(process.env.E2E_USER);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}
```

## Reports

| Format    | File                    | For                                                                                                                                                                                                                                      |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html`    | `ng-health-report.html` | People. One self-contained file with no external assets: score gauge, category scores, quality gate, Top 10 fixes, a sortable and filterable findings table, bundle, Lighthouse and accessibility details. Print it to PDF for handover. |
| `json`    | `ng-health-report.json` | Machines. Versioned schema `report.v1.json` (shipped in `dist/schema/`); within 1.x, fields are only added.                                                                                                                              |
| `md`      | `ng-health-report.md`   | Pull request comments. A short summary with a hidden marker so CI can update its previous comment.                                                                                                                                       |
| `console` | (stdout)                | Terminals. A colored summary table.                                                                                                                                                                                                      |

**Trends:** `--baseline old.json` (or `baseline: previousResult` in the API) adds score deltas
and new/resolved findings. Findings are matched by a fingerprint that ignores line numbers.

Reports never contain absolute paths, so they're safe to share.

## Write a custom check

A check is an object with an `id`, a `name`, a `category` and an async `run(ctx)` that returns
findings. Put it in a module and list it under `plugins` in the config. It then runs alongside
the built-in checks, appears in every report, and its category gets a score.

**1. Create the check.** This one flags `TODO`/`FIXME` comments:

<!-- plugin-example:start -->

```js
// checks/todo-comments.mjs
import { defineCheck } from 'ng-health';

export default defineCheck({
  id: 'custom/todo-comments', // unique, lowercase, "category/name"
  name: 'TODO comments',
  category: 'custom', // a built-in category or your own
  description: 'Flags TODO and FIXME comments left in source files.',
  async run(ctx) {
    const max = typeof ctx.options.max === 'number' ? ctx.options.max : 0;
    const findings = [];
    for (const file of await ctx.glob('src/**/*.ts')) {
      const lines = (await ctx.readText(file)).split('\n');
      lines.forEach((text, i) => {
        if (/\/\/\s*(TODO|FIXME)\b/.test(text)) {
          findings.push({
            severity: 'low',
            message: `Unresolved comment: ${text.trim()}`,
            file,
            line: i + 1,
            fixHint: 'Resolve it, or turn it into a ticket and remove the comment.',
          });
        }
      });
    }
    // Optional: return your own 0–100 score. Without one, it is derived from severities.
    return {
      score: findings.length <= max ? 100 : Math.max(0, 100 - findings.length * 5),
      findings,
    };
  },
});
```

<!-- plugin-example:end -->

**2. Register it** in the config. Paths are relative to the config file. Package names are
resolved from the project's `node_modules`. TypeScript plugins (`.ts`) work without a build step.

```json
{
  "plugins": ["./checks/todo-comments.mjs"],
  "checks": { "custom/todo-comments": { "options": { "max": 5 } } },
  "weights": { "custom": 5 }
}
```

**3. Run it:** `npx ng-health audit . --only custom` runs just your check while you develop it.
A complete example with a TypeScript check and a TypeScript config is in
[`examples/custom-check`](examples/custom-check).

### The check contract

| Field              | Required | Description                                                                                                       |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`               | yes      | Unique, lowercase kebab-case, namespaced: `category/name`.                                                        |
| `name`             | yes      | Human-readable name shown in reports.                                                                             |
| `category`         | yes      | A built-in category (`dependencies`, `bundle`, `angular`, `hygiene`, `performance`, `accessibility`) or your own. |
| `run(ctx)`         | yes      | Returns `{ findings, score?, meta? }`. Throw to report the check as errored; call `skipCheck(reason)` to skip it. |
| `description`      | no       | Shown in docs and reports.                                                                                        |
| `timeoutMs`        | no       | Default 120 s; overridable per project with `checks.<id>.timeoutMs`.                                              |
| `exclusive`        | no       | `true` if it must not run concurrently with other checks (builds, browsers).                                      |
| `enabledByDefault` | no       | `false` makes it opt-in: enable with `checks.<id>: true`.                                                         |

A **finding** has:

- `severity`: `critical`, `high`, `medium` or `low`
- `message`
- `fixHint` (required, because every finding must say what to do)
- optionally `file` (relative to the project root), `line`, `column`, `docsUrl` and `ruleId`

Findings with the same `ruleId` and `fixHint` are grouped into one Top-10 fix.

Plugins are validated when they load, and the error names the exact problem, for example
`"run" must be a function`. A check that returns invalid data is reported as errored instead of
crashing the audit.

The **context** (`ctx`) gives you:

| Member                     | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `ctx.root`, `ctx.project`  | Project root and detected setup (Angular version, package manager, projects, SSR).   |
| `ctx.options`              | `checks.<id>.options` from the config (category-level options merged in).            |
| `ctx.glob(patterns)`       | Project files as relative paths, honouring the `ignore` globs.                       |
| `ctx.readText(path)`       | Read a project file.                                                                 |
| `ctx.exec(cmd, args)`      | Run a command in the project (no shell); returns `{ stdout, stderr, exitCode }`.     |
| `ctx.shared(key, factory)` | Compute something once per audit and share it between checks.                        |
| `ctx.signal`               | Aborted on timeout or cancellation; pass it on to long-running work.                 |
| `ctx.offline`, `ctx.now()` | Respect `--offline`; use `now()` rather than `new Date()` so tests can control time. |
| `ctx.logger.debug(msg)`    | Debug output (`--verbose`).                                                          |
| `ctx.onCleanup(fn)`        | Teardown that runs after all checks, even when cancelled.                            |

A module may export one check, an array of checks (`export default [a, b]`), or
`export const checks = [...]`. To contribute a built-in check, see [CONTRIBUTING.md](CONTRIBUTING.md).

## CI setup

`--ci` turns off the spinner, prints the Markdown summary to stdout, writes
`ng-health-report.md`, and exits 1 when a threshold fails. On GitHub Actions it also adds:

- inline annotations on the PR diff: errors for critical/high findings, warnings for medium ones
- the summary on the job's summary page

```yaml
# .github/workflows/ng-health.yml (minimal)
name: Frontend health
on: pull_request
jobs:
  audit:
    runs-on: ubuntu-latest # Chrome is preinstalled
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: lts/*, cache: npm }
      - run: npm ci
      - run: npx ng-health audit . --ci --format html,json,md --out ng-health-report
      - uses: actions/upload-artifact@v7
        if: always()
        with: { name: ng-health-report, path: ng-health-report/ }
```

A complete workflow is in
[`examples/github-actions/ng-health.yml`](examples/github-actions/ng-health.yml). On top of the
minimal one, it adds a baseline from `main` (score deltas) and a single PR comment that's
updated on every run.

On other CI systems, run
`npx ng-health audit . --ci --format html,json,md --out ng-health-report` and publish the
folder as an artifact.

## Troubleshooting

- **"No Angular project found"**: run it from the folder that holds `angular.json`, or pass it: `ng-health audit apps/web`.
- **Bundle check skipped ("No build output")**: install dependencies so ng-health can run `ng build`, or build first and pass `--no-build`.
- **Runtime checks skipped ("Chromium not available")**: install Chrome, run `npx playwright install chromium`, or set `CHROME_PATH`.
- **Outdated/vulnerability checks skipped**: you are offline (`--offline` / `offline: true`), or there is no lockfile.
- **A check errored**: re-run with `--verbose` for its stack trace. The rest of the report is still valid.

## License

[MIT](LICENSE)
