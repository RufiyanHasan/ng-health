import { SEVERITIES } from '../core/config/schema.js';
import type { AuditReport, ReportCheck } from '../core/report.js';
import type { ReportedFinding } from '../core/types.js';
import {
  band,
  categoryLabel,
  findingsByCategory,
  formatBytes,
  formatDelta,
  location,
  SEVERITY_LABELS,
} from './format.js';

/** Escapes text for HTML element content and attribute values. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
const safeUrl = (url: string | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined);

const link = (url: string | undefined, text: string) => {
  const safe = safeUrl(url);
  return safe
    ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
    : '';
};

const scoreText = (score: number | undefined) => (score === undefined ? '–' : String(score));

function gauge(score: number | undefined, grade: string | undefined): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = score === undefined ? 0 : (score / 100) * c;
  return `<svg class="gauge band-${band(score)}" viewBox="0 0 120 120" role="img" aria-label="Overall score ${esc(scoreText(score))} out of 100">
  <circle cx="60" cy="60" r="${r}" class="gauge-track"/>
  <circle cx="60" cy="60" r="${r}" class="gauge-fill" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
  <text x="60" y="60" class="gauge-score">${esc(scoreText(score))}</text>
  <text x="60" y="82" class="gauge-grade">${grade ? `Grade ${esc(grade)}` : 'not scored'}</text>
</svg>`;
}

const delta = (d: number | undefined) =>
  d === undefined
    ? ''
    : `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${esc(formatDelta(d))}</span>`;

function header(report: AuditReport): string {
  const p = report.project;
  const facts: [string, string][] = [
    ['Angular', p.angularVersion ?? 'unknown'],
    ['Package manager', p.packageManager],
    [
      'Structure',
      p.kind === 'workspace' ? `Workspace, ${p.projects.length} projects` : 'Single application',
    ],
    ['Rendering', p.ssr ? 'SSR / prerendering' : 'Client-side'],
    ['Generated', new Date(report.generatedAt).toUTCString().replace(' GMT', ' UTC')],
    ['Audit duration', `${(report.durationMs / 1000).toFixed(1)} s`],
  ];
  if (p.nx) facts.splice(3, 0, ['Monorepo', 'Nx']);
  const verdict = report.thresholds.length
    ? `<span class="pill ${report.passed ? 'pass' : 'fail'}">${report.passed ? 'Quality gate passed' : 'Quality gate failed'}</span>`
    : '';
  const trend = report.trend
    ? `<p class="muted">${delta(report.trend.overall.delta)} vs. baseline from ${esc(report.trend.baselineGeneratedAt.slice(0, 10))}</p>`
    : '';
  return `<header class="hero">
  <div>
    <p class="eyebrow">Frontend Health Report</p>
    <h1>${esc(p.name)}</h1>
    ${verdict}${trend}
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </div>
  ${gauge(report.score.overall, report.score.grade)}
</header>`;
}

function categories(report: AuditReport): string {
  if (!report.categories.length) return '';
  const counts = findingsByCategory(report);
  const cards = report.categories
    .map((c) => {
      const d = report.trend?.categories.find((t) => t.id === c.id)?.delta;
      const n = counts.get(c.id) ?? 0;
      return `<div class="card category band-${band(c.score)}">
  <div class="cat-head"><h3>${esc(categoryLabel(c.id))}</h3><span class="cat-score">${esc(scoreText(c.score))}${delta(d)}</span></div>
  <div class="bar"><span style="width:${c.score ?? 0}%"></span></div>
  <p class="muted">${n} finding${n === 1 ? '' : 's'} · weight ${esc(c.weight)}</p>
</div>`;
    })
    .join('\n');
  return `<section><h2>Scores by category</h2><div class="grid">${cards}</div></section>`;
}

function topFixes(report: AuditReport): string {
  if (!report.topFixes.length) return '';
  const items = report.topFixes
    .map(
      (f) => `<li class="fix">
  <div class="fix-head"><span class="sev sev-${f.severity}">${esc(SEVERITY_LABELS[f.severity])}</span>
    <strong>${esc(f.message)}</strong></div>
  <p>${esc(f.fixHint)} ${link(f.docsUrl, 'Docs ↗')}</p>
  <p class="muted small">${esc(categoryLabel(f.category))} · ${esc(f.checkName)}${f.files.length ? ` · ${f.files.map((x) => `<code>${esc(x)}</code>`).join(', ')}` : ''}</p>
</li>`,
    )
    .join('\n');
  return `<section class="page-break"><h2>Top ${report.topFixes.length} fixes</h2>
<p class="muted">Ranked by impact: severity × category weight × number of occurrences.</p>
<ol class="fixes">${items}</ol></section>`;
}

function thresholds(report: AuditReport): string {
  if (!report.thresholds.length) return '';
  const rows = report.thresholds
    .map(
      (t) =>
        `<tr><td>${t.passed ? '<span class="ok">✔</span>' : '<span class="bad">✖</span>'}</td><td>${esc(t.description)}</td><td class="num">${esc(t.actual ?? 'n/a')}</td><td class="num">${esc(t.expected)}</td></tr>`,
    )
    .join('');
  return `<section><h2>Quality gate</h2><div class="scroll"><table class="compact"><thead><tr><th></th><th>Threshold</th><th class="num">Actual</th><th class="num">Expected</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function trend(report: AuditReport): string {
  const t = report.trend;
  if (!t) return '';
  const list = (items: ReportedFinding[]) =>
    items.length
      ? `<ul class="plain">${items
          .slice(0, 50)
          .map(
            (f) =>
              `<li><span class="sev sev-${f.severity}">${esc(SEVERITY_LABELS[f.severity])}</span> ${esc(f.message)} ${location(f) ? `<code>${esc(location(f))}</code>` : ''}</li>`,
          )
          .join(
            '',
          )}${items.length > 50 ? `<li class="muted">…and ${items.length - 50} more</li>` : ''}</ul>`
      : '<p class="muted">None.</p>';
  const rows = t.categories
    .map(
      (c) =>
        `<tr><td>${esc(categoryLabel(c.id))}</td><td class="num">${esc(scoreText(c.before))}</td><td class="num">${esc(scoreText(c.after))}</td><td class="num">${delta(c.delta)}</td></tr>`,
    )
    .join('');
  return `<section><h2>Trend vs. baseline</h2>
<p class="muted">Baseline generated ${esc(t.baselineGeneratedAt.slice(0, 10))} by fe-health ${esc(t.baselineVersion)}.</p>
<div class="scroll"><table class="compact"><thead><tr><th>Category</th><th class="num">Before</th><th class="num">After</th><th class="num">Δ</th></tr></thead>
<tbody><tr><td><strong>Overall</strong></td><td class="num">${esc(scoreText(t.overall.before))}</td><td class="num">${esc(scoreText(t.overall.after))}</td><td class="num">${delta(t.overall.delta)}</td></tr>${rows}</tbody></table></div>
<div class="two-col"><div><h3>New findings (${t.newFindings.length})</h3>${list(t.newFindings)}</div>
<div><h3>Resolved findings (${t.resolvedFindings.length})</h3>${list(t.resolvedFindings)}</div></div></section>`;
}

function findingsTable(report: AuditReport): string {
  const checkNames = new Map(report.checks.map((c) => [c.id, c.name]));
  const categoriesPresent = [...new Set(report.findings.map((f) => f.category))];
  const counts = report.summary.findings;
  const toggles = SEVERITIES.map(
    (s) =>
      `<label class="toggle"><input type="checkbox" data-filter-severity value="${s}" checked> <span class="sev sev-${s}">${esc(SEVERITY_LABELS[s])}</span> ${counts[s]}</label>`,
  ).join('');
  const rows = report.findings
    .map((f) => {
      const where = location(f);
      return `<tr data-severity="${f.severity}" data-category="${esc(f.category)}" data-rank="${SEVERITIES.indexOf(f.severity)}">
<td><span class="sev sev-${f.severity}">${esc(SEVERITY_LABELS[f.severity])}</span></td>
<td>${esc(categoryLabel(f.category))}</td>
<td>${esc(checkNames.get(f.checkId) ?? f.checkId)}</td>
<td>${esc(f.message)}${where ? `<div><code>${esc(where)}</code></div>` : ''}</td>
<td>${esc(f.fixHint)} ${link(f.docsUrl, 'Docs ↗')}</td></tr>`;
    })
    .join('\n');
  return `<section class="page-break"><h2>All findings (${report.findings.length})</h2>
<div class="controls" role="search">
  ${toggles}
  <select data-filter-category aria-label="Category"><option value="">All categories</option>${categoriesPresent
    .map((c) => `<option value="${esc(c)}">${esc(categoryLabel(c))}</option>`)
    .join('')}</select>
  <input type="search" data-filter-text placeholder="Search findings…" aria-label="Search findings">
  <span class="muted" data-visible-count></span>
</div>
${
  report.findings.length
    ? `<div class="scroll"><table class="findings"><thead><tr>
<th data-sort="rank" aria-sort="ascending">Severity</th><th data-sort="text:1">Category</th><th data-sort="text:2">Check</th><th data-sort="text:3">Finding</th><th>How to fix</th>
</tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted">No findings. 🎉</p>'
}</section>`;
}

const meta = (
  report: AuditReport,
  id: string,
): (ReportCheck['meta'] & Record<string, unknown>) | undefined =>
  report.checks.find((c) => c.id === id && c.status === 'completed')?.meta;

function bundleDetails(report: AuditReport): string {
  const m = meta(report, 'bundle/size') as
    | {
        initialBytes: number;
        initialGzipBytes: number;
        lazyBytes: number;
        totalBytes: number;
        statsSource: string;
        topModules: { path: string; bytes: number }[];
        largestLazyChunks: { name: string; bytes: number }[];
        budgets: {
          type: string;
          name?: string;
          actualBytes: number;
          warningBytes?: number;
          errorBytes?: number;
        }[];
      }
    | undefined;
  if (!m) return '';
  const max = Math.max(1, ...m.topModules.map((x) => x.bytes));
  const modules = m.topModules.length
    ? `<h3>Largest modules</h3><div class="scroll"><table class="compact"><tbody>${m.topModules
        .map(
          (x) =>
            `<tr><td><code>${esc(x.path)}</code></td><td class="num">${esc(formatBytes(x.bytes))}</td><td class="barcell"><div class="bar thin"><span style="width:${((x.bytes / max) * 100).toFixed(1)}%"></span></div></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="muted">Module breakdown needs a stats file (fe-health passes --stats-json when it builds).</p>';
  const lazy = m.largestLazyChunks.length
    ? `<h3>Largest lazy chunks</h3><div class="scroll"><table class="compact"><tbody>${m.largestLazyChunks
        .slice(0, 5)
        .map(
          (x) =>
            `<tr><td><code>${esc(x.name)}</code></td><td class="num">${esc(formatBytes(x.bytes))}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';
  return `<section><h2>Bundle</h2>
<div class="stats">
  <div><span class="stat">${esc(formatBytes(m.initialBytes))}</span><span class="muted">Initial (raw)</span></div>
  <div><span class="stat">${esc(formatBytes(m.initialGzipBytes))}</span><span class="muted">Initial (gzip)</span></div>
  <div><span class="stat">${esc(formatBytes(m.lazyBytes))}</span><span class="muted">Lazy chunks</span></div>
  <div><span class="stat">${esc(formatBytes(m.totalBytes))}</span><span class="muted">Total</span></div>
</div>
<div class="two-col"><div>${modules}</div><div>${lazy}</div></div></section>`;
}

function performanceDetails(report: AuditReport): string {
  const m = meta(report, 'performance/lighthouse') as
    | {
        formFactor: string;
        routes: {
          route: string;
          error?: string;
          scores?: Record<string, number | null>;
          metrics?: Record<string, number | null>;
        }[];
      }
    | undefined;
  if (!m) return '';
  const s = (v: number | null | undefined) =>
    v === null || v === undefined ? '–' : `<span class="score band-${band(v)}">${v}</span>`;
  const ms = (v: number | null | undefined, unit = 's') =>
    v === null || v === undefined
      ? '–'
      : unit === 's'
        ? `${(v / 1000).toFixed(1)} s`
        : unit === 'ms'
          ? `${Math.round(v)} ms`
          : v.toFixed(2);
  const rows = m.routes
    .map((r) =>
      r.error
        ? `<tr><td><code>${esc(r.route)}</code></td><td colspan="7" class="bad">${esc(r.error)}</td></tr>`
        : `<tr><td><code>${esc(r.route)}</code></td><td class="num">${s(r.scores?.['performance'])}</td><td class="num">${s(r.scores?.['accessibility'])}</td><td class="num">${s(r.scores?.['bestPractices'])}</td><td class="num">${s(r.scores?.['seo'])}</td><td class="num">${ms(r.metrics?.['lcp'])}</td><td class="num">${ms(r.metrics?.['tbt'], 'ms')}</td><td class="num">${ms(r.metrics?.['cls'], '')}</td></tr>`,
    )
    .join('');
  return `<section><h2>Lighthouse (${esc(m.formFactor)})</h2>
<div class="scroll"><table class="compact"><thead><tr><th>Route</th><th class="num">Perf.</th><th class="num">A11y</th><th class="num">Best pr.</th><th class="num">SEO</th><th class="num">LCP</th><th class="num">TBT</th><th class="num">CLS</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function a11yDetails(report: AuditReport): string {
  const m = meta(report, 'accessibility/axe') as
    | {
        tags: string[];
        violations: {
          id: string;
          impact: string;
          help: string;
          helpUrl: string;
          nodes: number;
          routes: { route: string; selectors: string[] }[];
        }[];
      }
    | undefined;
  if (!m) return '';
  const body = m.violations.length
    ? m.violations
        .map(
          (
            v,
          ) => `<details class="violation"><summary><span class="impact impact-${esc(v.impact)}">${esc(v.impact)}</span> <strong>${esc(v.help)}</strong> <span class="muted">${v.nodes} element${v.nodes === 1 ? '' : 's'} · ${esc(v.id)}</span></summary>
<p>${link(v.helpUrl, 'How to fix ↗')}</p>
${v.routes
  .map(
    (r) =>
      `<p class="small"><code>${esc(r.route)}</code></p><ul class="selectors">${r.selectors
        .slice(0, 25)
        .map((sel) => `<li><code>${esc(sel)}</code></li>`)
        .join(
          '',
        )}${r.selectors.length > 25 ? `<li class="muted">…and ${r.selectors.length - 25} more</li>` : ''}</ul>`,
  )
  .join('')}
</details>`,
        )
        .join('\n')
    : '<p class="muted">No WCAG violations detected by axe-core.</p>';
  return `<section><h2>Accessibility (WCAG)</h2><p class="muted">axe-core rules: ${esc(m.tags.join(', '))}</p>${body}</section>`;
}

function checksTable(report: AuditReport): string {
  const rows = report.checks
    .map(
      (c) =>
        `<tr class="status-${c.status}"><td><code>${esc(c.id)}</code></td><td>${esc(c.name)}</td><td><span class="status ${c.status}">${esc(c.status)}</span></td><td class="num">${esc(scoreText(c.score))}</td><td class="num">${c.findingCount}</td><td class="num">${(c.durationMs / 1000).toFixed(1)} s</td><td>${esc(c.reason ?? '')}</td></tr>`,
    )
    .join('');
  return `<section class="page-break"><h2>Checks</h2>
<div class="scroll"><table class="compact"><thead><tr><th>Check</th><th>Name</th><th>Status</th><th class="num">Score</th><th class="num">Findings</th><th class="num">Time</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5d6678;--border:#e2e5eb;--accent:#3949ab;
--good:#1e8e3e;--ok:#b26a00;--poor:#c62828;--none:#9aa1ad;
--critical:#b71c1c;--high:#e65100;--medium:#a66f00;--low:#546e7a;}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#13161c;--card:#1b1f27;--text:#e6e8ec;--muted:#9aa3b2;--border:#2c323d;--accent:#8c9eff;--good:#5bd27a;--ok:#ffb74d;--poor:#ff6b6b;--critical:#ff6b6b;--high:#ff9a5a;--medium:#ffcc66;--low:#9fb3bf}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:30px;margin:4px 0 8px}h2{font-size:20px;margin:0 0 12px}h3{font-size:15px;margin:16px 0 8px}
a{color:var(--accent)}code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in srgb,var(--border) 45%,transparent);padding:1px 4px;border-radius:4px;word-break:break-all}
section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin:16px 0}
.hero{display:flex;justify-content:space-between;gap:24px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px}.hero>div{flex:1;min-width:0}
.scroll{overflow-x:auto}p,li,td,strong{overflow-wrap:break-word}.findings td:nth-child(2){white-space:nowrap}
.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:var(--muted);margin:0}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 24px;margin:16px 0 0}
.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:0;font-weight:600}
.gauge{width:170px;height:170px;flex:none}.gauge-track{fill:none;stroke:var(--border);stroke-width:10}
.gauge-fill{fill:none;stroke-width:10;stroke-linecap:round;stroke:var(--none)}
.band-good .gauge-fill{stroke:var(--good)}.band-ok .gauge-fill{stroke:var(--ok)}.band-poor .gauge-fill{stroke:var(--poor)}
.gauge-score{font-size:34px;font-weight:700;text-anchor:middle;dominant-baseline:middle;fill:var(--text)}
.gauge-grade{font-size:11px;text-anchor:middle;fill:var(--muted)}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:600;font-size:13px}
.pill.pass{background:color-mix(in srgb,var(--good) 15%,transparent);color:var(--good)}
.pill.fail{background:color-mix(in srgb,var(--poor) 15%,transparent);color:var(--poor)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:10px;padding:14px}
.cat-head{display:flex;justify-content:space-between;align-items:baseline}.cat-head h3{margin:0}
.cat-score{font-size:24px;font-weight:700}
.band-good .cat-score,.score.band-good{color:var(--good)}.band-ok .cat-score,.score.band-ok{color:var(--ok)}.band-poor .cat-score,.score.band-poor{color:var(--poor)}.band-none .cat-score{color:var(--none)}
.bar{height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin:8px 0}.bar span{display:block;height:100%;background:var(--none)}
.bar.thin{height:6px;margin:0;min-width:80px}.barcell{width:30%}
.band-good .bar span{background:var(--good)}.band-ok .bar span{background:var(--ok)}.band-poor .bar span{background:var(--poor)}.bar.thin span{background:var(--accent)}
.muted{color:var(--muted)}.small{font-size:13px}.ok{color:var(--good)}.bad{color:var(--poor)}
.delta{font-size:13px;margin-left:6px;color:var(--muted)}.delta.up{color:var(--good)}.delta.down{color:var(--poor)}
.sev,.impact{display:inline-block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:1px 7px;border-radius:4px;color:#fff;white-space:nowrap}
.sev-critical,.impact-critical{background:var(--critical)}.sev-high,.impact-serious{background:var(--high)}.sev-medium,.impact-moderate{background:var(--medium)}.sev-low,.impact-minor{background:var(--low)}
.fixes{padding-left:22px;margin:0}.fix{margin:0 0 14px}.fix p{margin:4px 0}.fix-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--border)}
th{font-size:12.5px;color:var(--muted);font-weight:600}th[data-sort]{cursor:pointer;user-select:none}th[data-sort]:after{content:" ↕";opacity:.35}
th[aria-sort=ascending]:after{content:" ↑";opacity:1}th[aria-sort=descending]:after{content:" ↓";opacity:1}
table.compact td,table.compact th{padding:6px 8px}.num{text-align:right;white-space:nowrap}
.findings td:nth-child(4){width:38%}.findings td:nth-child(5){width:32%;color:var(--muted)}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.controls input[type=search],.controls select{font:inherit;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)}
.controls input[type=search]{flex:1;min-width:180px}.toggle{display:flex;gap:4px;align-items:center;font-size:13px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.stats div{display:flex;flex-direction:column}.stat{font-size:22px;font-weight:700}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.plain{list-style:none;padding:0}.plain li{margin:6px 0}.selectors{margin:4px 0 8px;padding-left:18px}
details.violation{border-top:1px solid var(--border);padding:8px 0}details.violation summary{cursor:pointer}
.status{font-size:12px;font-weight:600}.status.completed{color:var(--good)}.status.errored{color:var(--poor)}.status.skipped{color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:13px;margin-top:24px}
@media (max-width:760px){.hero{flex-direction:column-reverse;align-items:flex-start}.two-col{grid-template-columns:1fr}.findings thead{display:none}.findings tr{display:block;border-bottom:1px solid var(--border);padding:8px 0}.findings td{display:block;border:0;padding:2px 0;width:auto!important}}
@media print{
:root{--bg:#fff;--card:#fff;--text:#000;--muted:#444;--border:#ccc}
body{font-size:11pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}main{max-width:none;padding:0}
section,.hero{border:0;padding:0;margin:0 0 18pt;break-inside:auto}.page-break{break-before:page}
.controls,th[data-sort]:after{display:none}tr,.fix,.card{break-inside:avoid}a{color:inherit;text-decoration:none}
}`;

const SCRIPT = `
(() => {
  const table = document.querySelector('table.findings');
  const rows = table ? [...table.tBodies[0].rows] : [];
  const sev = [...document.querySelectorAll('[data-filter-severity]')];
  const cat = document.querySelector('[data-filter-category]');
  const text = document.querySelector('[data-filter-text]');
  const count = document.querySelector('[data-visible-count]');
  const apply = () => {
    const allowed = new Set(sev.filter((c) => c.checked).map((c) => c.value));
    const q = (text && text.value || '').trim().toLowerCase();
    let visible = 0;
    for (const r of rows) {
      const show = allowed.has(r.dataset.severity) && (!cat || !cat.value || r.dataset.category === cat.value) && (!q || r.textContent.toLowerCase().includes(q));
      r.hidden = !show;
      if (show) visible++;
    }
    if (count) count.textContent = visible + ' of ' + rows.length + ' shown';
  };
  [...sev, cat, text].forEach((el) => el && el.addEventListener('input', apply));
  if (table) {
    table.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      table.querySelectorAll('th[data-sort]').forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir);
      const key = th.dataset.sort;
      const value = (r) => key === 'rank' ? Number(r.dataset.rank) : r.cells[Number(key.split(':')[1])].textContent.trim().toLowerCase();
      rows.sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'ascending' ? 1 : -1); });
      rows.forEach((r) => table.tBodies[0].appendChild(r));
    }));
  }
  window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  apply();
})();`;

/** Self-contained, print-friendly HTML report: no external scripts, styles, fonts or images. */
export function renderHtml(report: AuditReport): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(report.tool.name)} ${esc(report.tool.version)}">
<title>Frontend health · ${esc(report.project.name)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${header(report)}
${categories(report)}
${thresholds(report)}
${topFixes(report)}
${trend(report)}
${findingsTable(report)}
${bundleDetails(report)}
${performanceDetails(report)}
${a11yDetails(report)}
${checksTable(report)}
<footer>Generated locally by ${esc(report.tool.name)} v${esc(report.tool.version)} · report schema ${esc(report.schemaVersion)} · no data left this machine.</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
