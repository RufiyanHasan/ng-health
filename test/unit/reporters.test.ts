import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderConsole } from '../../src/reporters/console.js';
import { esc, renderHtml } from '../../src/reporters/html.js';
import { writeReports } from '../../src/reporters/index.js';
import { renderJson } from '../../src/reporters/json.js';
import { md, MARKDOWN_MARKER, renderMarkdown } from '../../src/reporters/markdown.js';
import { computeTrend } from '../../src/core/baseline.js';
import { silentLogger } from '../../src/core/logger.js';
import { reported, sampleReport } from '../helpers/report.js';
import { makeTempProject } from '../helpers/tmp.js';

const stripAnsi = stripVTControlCharacters;

function withTrend() {
  const report = sampleReport();
  const baseline = {
    ...report,
    score: { overall: 50, grade: 'F' as const },
    categories: report.categories.map((c) => ({ ...c, score: 40 })),
    findings: [
      ...report.findings.slice(1),
      reported('angular/any-usage', { message: 'Fixed since' }),
    ],
  };
  return { ...report, trend: computeTrend(baseline, report) };
}

describe('markdown', () => {
  it('renders a PR-comment summary', () => {
    expect(renderMarkdown(sampleReport())).toMatchSnapshot();
  });

  it('renders trend deltas and new/resolved findings', () => {
    const out = renderMarkdown(withTrend());
    expect(out.startsWith(MARKDOWN_MARKER)).toBe(true);
    expect(out).toContain('| Category | Score | Δ |');
    expect(out).toContain('(1 new, 1 resolved)');
    expect(out).toContain('<summary>New findings (1)</summary>');
    expect(out).toContain('- 🔴 lodash: Prototype pollution');
    expect(out).toContain('<summary>Resolved findings (1)</summary>');
  });

  it('escapes markdown control characters', () => {
    expect(md('a|b *c* `d` <e>')).toBe('a\\|b \\*c\\* \\`d\\` \\<e\\>');
  });
});

describe('console', () => {
  it('renders scores, findings, top fixes, incomplete checks and thresholds', () => {
    const out = stripAnsi(renderConsole(withTrend()));
    expect(out).toContain('acme-shop · Angular 19.2.4 · npm · single app');
    expect(out).toMatch(/Overall score \d+ \([A-F]\) {2}\+\d+ vs baseline/);
    expect(out).toMatch(/│ Angular code\s+│\s+\d+ │\s+3 │\s+\+\d+ │/);
    expect(out).toContain('Findings: 1 critical · 0 high · 2 medium · 1 low (1 new, 1 resolved)');
    expect(out).toContain('1. [critical] lodash: Prototype pollution');
    expect(out).toContain('skipped performance/lighthouse — Chromium not available.');
    expect(out).toContain('errored hygiene/coverage — boom');
    expect(out).toContain('✖ Critical vulnerabilities: 1 (expected ≤ 0)');
  });
});

describe('html', () => {
  const html = renderHtml(withTrend());

  it('is self-contained: no external scripts, styles, fonts or images', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/<img[^>]+src=["']?https?:/i);
  });

  it('escapes user content and refuses non-http links', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('XSS &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Do &lt;b&gt;not&lt;/b&gt; do that');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href="https://github.com/advisories/GHSA-x"');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('contains every report section', () => {
    for (const text of [
      '<title>Frontend health · acme-shop</title>',
      'Quality gate failed',
      'Scores by category',
      'Top 3 fixes',
      'Trend vs. baseline',
      'All findings (4)',
      'data-filter-severity',
      'data-sort="rank"',
      'Largest modules',
      'node_modules/@angular/core/fesm2022/core.mjs',
      'Chromium not available.',
      'no data left this machine',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('/secret/home/user');
  });
});

describe('json + writeReports', () => {
  it('writes the requested files and returns their paths', async () => {
    const dir = await makeTempProject({});
    const out = path.join(dir, 'reports');
    const printed: string[] = [];
    const files = await writeReports(sampleReport(), ['console', 'html', 'json', 'md'], out, {
      ...silentLogger,
      out: (m) => printed.push(m),
    });
    expect(files.map((f) => path.basename(f))).toEqual([
      'ng-health-report.html',
      'ng-health-report.json',
      'ng-health-report.md',
    ]);
    expect(JSON.parse(await readFile(path.join(out, 'ng-health-report.json'), 'utf8'))).toEqual(
      JSON.parse(renderJson(sampleReport())),
    );
    expect(printed).toHaveLength(1);
    expect(await writeReports(sampleReport(), ['console'], out, silentLogger)).toEqual([]);
  });

  it('reports unwritable output directories as tool errors', async () => {
    const dir = await makeTempProject({});
    const blocker = path.join(dir, 'file');
    await writeFile(blocker, '');
    await expect(writeReports(sampleReport(), ['json'], blocker, silentLogger)).rejects.toThrow(
      /Could not write reports/,
    );
  });
});
