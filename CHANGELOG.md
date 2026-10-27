# ng-health

## 0.1.0

### Minor Changes

First release: a CLI and library that audits Angular codebases and produces a scored,
actionable health report.

- `ng-health audit`, `ng-health init` and `--version`, with exit codes 0 (pass), 1 (threshold
  failed) and 2 (tool error), plus clean shutdown on SIGINT/SIGTERM.
- Library API: `audit()`, `generateReport()`, `defineConfig()`, `defineCheck()`, and typed
  errors (`ConfigError`, `CheckError`, `ProjectError`). The library never prints, writes files
  or exits, and supports cancellation through an `AbortSignal`.
- Config as `ng-health.config.{ts,mts,js,mjs,cjs,json}`, validated with zod; JSON Schemas ship
  in `dist/schema/`.
- Auto-detection of the Angular version, package manager, workspace layout, SSR and Nx.
- Plugin architecture: custom checks in JavaScript or TypeScript, validated at load time;
  parallel runner with per-check timeouts and isolation; weighted scores and thresholds.
- Built-in checks for:
  - dependencies: Angular support status, outdated packages judged against the project's
    Angular version, vulnerabilities, deprecated packages
  - bundle size and budgets
  - eight Angular anti-patterns
  - code hygiene
  - Lighthouse
  - axe-core WCAG
- `--url`, `--routes` and `--login-script` for deployed and auth-protected apps.
- Reports: HTML (self-contained, print-friendly), JSON (`report.v1.json`), Markdown and
  console, with Top 10 fixes and `--baseline` trends.
- `--ci` mode with GitHub annotations and job summary.
