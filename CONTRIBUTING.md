# Contributing to fe-health

Thanks for helping. This guide covers the local setup, the project layout, and how to add a
built-in check.

## Setup

```bash
git clone <repo> && cd fe-health
npm ci
npm run lint && npm test && npm run build   # all must pass before you open a PR
```

Node 22+ is required. Google Chrome (or `npx playwright install chromium`) is needed for the
browser tests; without it they are skipped automatically.

| Script              | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Bundles with tsup into `dist/` and regenerates `schema/*.json`.                 |
| `npm run lint`      | ESLint (typescript-eslint strict) + Prettier check.                             |
| `npm run format`    | Prettier write.                                                                 |
| `npm test`          | All tests with coverage thresholds (≥85% lines on `src/core` and `src/checks`). |
| `npm run test:unit` | Unit tests only (fast, no browser).                                             |
| `npm run typecheck` | `tsc --noEmit`.                                                                 |

Try your local build against the fixtures:

```bash
npm run build
node dist/cli/index.js audit test/fixtures/unhealthy --format html --out /tmp/report
```

## Layout

```
src/
  cli/          commander program, init command, signal handling
  core/         config (zod), detection, registry, runner, scoring, thresholds,
                report model + JSON schema, baseline/trend, top fixes
  checks/       one folder per category; one module per check
  runtime/      static server, Chrome discovery, shared Lighthouse/axe session
  reporters/    console, html, json, markdown
  ci/           GitHub annotations and job summary
test/
  unit/         per-module tests; unit/checks/ has the per-check tests
  integration/  runs the built CLI binary (built by test/setup/build-cli.ts)
  e2e/          real Chrome: Lighthouse, axe, login script, signal cleanup
  fixtures/     healthy/ and unhealthy/ Angular projects (see their README)
```

## Adding a built-in check

1. **Create the module** at `src/checks/<category>/<name>.ts` with
   `export default defineCheck({ id: '<category>/<name>', name, category, description, run })`.
   The contract is in the README section [Writing a custom check](README.md#writing-a-custom-check).
   Use the helpers in `src/checks/util.ts` (`num`, `bool`, `ratioScore`, `plural`, …). If several
   checks parse the same files, share the work through `ctx.shared(key, factory)`, as the Angular
   checks do with `getAngularAnalysis`.
2. **Register it** in `src/checks/index.ts`. Runtime (browser) checks go last and must be
   `exclusive: true`.
3. **Test it** in `test/unit/checks/`. Assert the _exact_ findings (severity, file, line,
   message) on the fixtures with `runOn(check, fixture('unhealthy'))` and `summarize(result)`,
   plus edge cases in temporary projects (`makeTempProject`). Stub external commands with
   `fakeExec`. Tests must never touch the network. `test/unit/builtin-checks.test.ts` fails if a
   built-in check has no unit test.
4. **Extend a fixture if needed.** Add the issue to `test/fixtures/unhealthy` (and keep `healthy`
   clean), update `test/fixtures/README.md`, then refresh the integration snapshot with
   `npx vitest run test/integration -u` and review the diff.
5. **Document it** in the README check table (with any options) and in `CHANGELOG.md`.

Guidelines for checks:

- Every finding needs an actionable `fixHint`. Add `docsUrl` when there is a good reference.
- Prefer ratio-based scores for "N of M items" checks, so large codebases aren't punished for size.
- Be version-aware: Angular and TypeScript defaults change (OnPush and `strictTemplates` became
  defaults in Angular 22; `strict` in TypeScript 6). Use `ctx.project.angular.major`.
- Skip (`skipCheck(reason)`) when there is nothing to assess, and say why in the reason.
  Throw only for real failures.
- No network access when `ctx.offline` is set. Never send project data anywhere.

## Commits and releases

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(checks): …`,
  `fix(runtime): …`, `docs: …`, `test: …`.
- Add user-facing changes to the `Unreleased` section of `CHANGELOG.md`.
- To release, bump `version` in `package.json`, move the changelog entries under the new version,
  merge, then create a GitHub release tagged `vX.Y.Z`. The publish workflow verifies the tag
  matches `package.json`, runs the full test suite, and publishes to the configured registry.
