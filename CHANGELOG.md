# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). The JSON report has its own version
(`schemaVersion`, currently `1.0`).

## [Unreleased]

## [0.1.0] - 2026-10-27

### Added

- `fe-health audit`, `fe-health init` and `--version`, with exit codes 0 (pass), 1 (threshold
  failed), 2 (tool error) and clean shutdown on SIGINT/SIGTERM.
- `fe-health.config.json` validated with zod, plus a published JSON Schema.
- Auto-detection of the Angular version, package manager, workspace layout, SSR and Nx.
- Plugin architecture: `defineCheck`, parallel runner with per-check timeouts and isolation,
  weighted category and overall scores, and thresholds.
- Built-in checks for dependencies (Angular support status, outdated, vulnerabilities,
  deprecated), bundle size and budgets, eight Angular anti-patterns, code hygiene, Lighthouse,
  and axe-core WCAG.
- `--url`, `--routes` and `--login-script` for auditing deployed and auth-protected apps.
- HTML (self-contained, print-friendly), JSON (`schema/report.v1.json`), Markdown and console
  reports; Top 10 fixes; `--baseline` trends.
- `--ci` mode with GitHub annotations and job summary, plus an example GitHub Actions workflow.

[Unreleased]: https://github.com/OWNER/fe-health/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/fe-health/releases/tag/v0.1.0
