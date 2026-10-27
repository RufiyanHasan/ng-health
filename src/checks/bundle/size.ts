import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathExists, readJsonFile } from '../../core/fs.js';
import { defineCheck, skipCheck, type CheckContext, type Finding } from '../../core/types.js';
import { bool, clampScore, num } from '../util.js';
import { resolveBuildOutput } from './output.js';
import { DEFAULT_BUDGETS, formatKb, KB, parseSize, type Budget } from './budgets.js';
import {
  initialFromIndexHtml,
  initialFromMetafile,
  initialFromWebpack,
  topModules,
  type EsbuildMetafile,
  type ModuleSize,
  type WebpackStats,
} from './stats.js';

interface AssetFile {
  name: string;
  /** Absolute path. */
  path: string;
  bytes: number;
  initial: boolean;
}

export interface BundleMeta {
  [key: string]: unknown;
  outputDir: string;
  built: boolean;
  initialBytes: number;
  initialKb: number;
  initialGzipBytes: number;
  lazyBytes: number;
  totalBytes: number;
  initialFiles: { name: string; bytes: number }[];
  largestLazyChunks: { name: string; bytes: number }[];
  topModules: ModuleSize[];
  statsSource: 'esbuild' | 'webpack' | 'index.html';
  budgets: {
    type: string;
    name?: string;
    actualBytes: number;
    warningBytes?: number;
    errorBytes?: number;
  }[];
}

interface AngularJsonBuild {
  projects?: Record<
    string,
    {
      architect?: Record<string, { configurations?: Record<string, { budgets?: Budget[] }> }>;
      targets?: Record<string, { configurations?: Record<string, { budgets?: Budget[] }> }>;
    }
  >;
}

async function readBudgets(ctx: CheckContext, app: string): Promise<Budget[]> {
  if (!ctx.project.workspaceFile) return DEFAULT_BUDGETS;
  const ws = await readJsonFile<AngularJsonBuild>(ctx.project.workspaceFile);
  const targets = ws?.projects?.[app]?.architect ?? ws?.projects?.[app]?.targets;
  const budgets = targets?.['build']?.configurations?.['production']?.budgets;
  return budgets?.some((b) => b.type === 'initial')
    ? budgets
    : [...DEFAULT_BUDGETS, ...(budgets ?? [])];
}

async function build(ctx: CheckContext, app: string): Promise<boolean> {
  const ng = path.join(
    ctx.root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'ng.cmd' : 'ng',
  );
  if (!(await pathExists(ng))) {
    ctx.logger.debug('Angular CLI is not installed locally; using existing build output');
    return false;
  }
  ctx.logger.debug(`Running ng build ${app} --configuration production --stats-json`);
  const r = await ctx.exec(ng, ['build', app, '--configuration', 'production', '--stats-json'], {
    env: { NG_CLI_ANALYTICS: 'false', CI: 'true' },
  });
  if (r.exitCode !== 0) {
    const tail = (r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | ');
    throw new Error(`Production build failed (exit ${r.exitCode}): ${tail}`);
  }
  return true;
}

async function listAssets(dir: string): Promise<Omit<AssetFile, 'initial'>[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile() && /\.(js|mjs|css)$/.test(e.name));
  return Promise.all(
    files.map(async (e) => {
      const file = path.join(e.parentPath, e.name);
      return { name: e.name, path: file, bytes: (await stat(file)).size };
    }),
  );
}

export default defineCheck({
  id: 'bundle/size',
  name: 'Bundle size',
  category: 'bundle',
  description:
    'Initial and lazy chunk sizes against angular.json budgets, plus the largest modules.',
  kind: 'static',
  exclusive: true,
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    const target = await resolveBuildOutput(ctx);
    if (!target) skipCheck('No application project found in angular.json');
    const { app, outputPath, outDir } = target;

    const built = ctx.build && bool(ctx, 'build', true) ? await build(ctx, app) : false;

    // Re-resolve: the build may have created <out>/browser.
    const { browserDir } = (await resolveBuildOutput(ctx)) ?? target;
    const assets = (await pathExists(browserDir)) ? await listAssets(browserDir) : [];
    if (!assets.some((a) => /\.m?js$/.test(a.name))) {
      skipCheck(
        `No build output in ${outputPath}. Install dependencies so fe-health can run "ng build", or build first and pass --no-build.`,
      );
    }

    // Classify initial vs lazy using the most precise source available.
    // Angular 17–21 write stats.json; 22+ writes browser-stats.json (and server-stats.json for SSR).
    let stats: EsbuildMetafile | WebpackStats | undefined;
    for (const name of ['browser-stats.json', 'stats.json']) {
      stats ??= await readJsonFile<EsbuildMetafile | WebpackStats>(path.join(outDir, name));
    }
    let initialNames: Set<string>;
    let statsSource: BundleMeta['statsSource'];
    if (stats && 'outputs' in stats) {
      initialNames = initialFromMetafile(stats);
      statsSource = 'esbuild';
    } else if (stats && 'chunks' in stats) {
      initialNames = initialFromWebpack(stats);
      statsSource = 'webpack';
    } else {
      const html = await readFile(path.join(browserDir, 'index.html'), 'utf8').catch(() => '');
      initialNames = initialFromIndexHtml(html);
      statsSource = 'index.html';
    }
    const files: AssetFile[] = assets.map((a) => ({ ...a, initial: initialNames.has(a.name) }));
    const initial = files.filter((f) => f.initial);
    const lazy = files.filter((f) => !f.initial && /\.m?js$/.test(f.name));
    const sum = (list: { bytes: number }[]) => list.reduce((s, f) => s + f.bytes, 0);
    const initialBytes = sum(initial);
    const initialGzipBytes = (
      await Promise.all(initial.map(async (f) => gzipSync(await readFile(f.path)).length))
    ).reduce((s, n) => s + n, 0);

    // Budgets
    const findings: Finding[] = [];
    const budgetResults: BundleMeta['budgets'] = [];
    const scripts = files.filter((f) => /\.m?js$/.test(f.name));
    const measure = (b: Budget): { label: string; bytes: number }[] => {
      switch (b.type) {
        case 'initial':
          return [{ label: 'Initial bundle', bytes: initialBytes }];
        case 'allScript':
          return [{ label: 'All scripts', bytes: sum(scripts) }];
        case 'all':
          return [{ label: 'All files', bytes: sum(files) }];
        case 'anyScript':
          return scripts.map((f) => ({ label: f.name, bytes: f.bytes }));
        case 'any':
          return files.map((f) => ({ label: f.name, bytes: f.bytes }));
        case 'bundle':
          return files
            .filter((f) => b.name && f.name.startsWith(`${b.name}-`))
            .map((f) => ({ label: `Bundle "${b.name}"`, bytes: f.bytes }));
        default:
          return []; // anyComponentStyle etc. need per-component data
      }
    };
    const budgets = await readBudgets(ctx, app);
    for (const b of budgets) {
      const warning = parseSize(b.maximumWarning);
      const error = parseSize(b.maximumError);
      if (warning === undefined && error === undefined) continue;
      for (const m of measure(b)) {
        budgetResults.push({
          type: b.type,
          ...(b.name ? { name: b.name } : {}),
          actualBytes: m.bytes,
          ...(warning ? { warningBytes: warning } : {}),
          ...(error ? { errorBytes: error } : {}),
        });
        const over =
          error !== undefined && m.bytes > error
            ? 'error'
            : warning !== undefined && m.bytes > warning
              ? 'warning'
              : undefined;
        if (!over) continue;
        const limit = (over === 'error' ? error : warning) as number;
        findings.push({
          severity: over === 'error' ? 'high' : 'medium',
          ruleId: `budget-${over}`,
          message: `${m.label} is ${formatKb(m.bytes)}, over the ${b.type} budget ${over} limit of ${formatKb(limit)}.`,
          file: ctx.project.workspaceFile ? path.basename(ctx.project.workspaceFile) : undefined,
          fixHint:
            'Lazy-load routes and heavy features (loadComponent/@defer), remove unused dependencies, and prefer tree-shakeable libraries.',
          docsUrl: 'https://angular.dev/tools/cli/build#configuring-size-budgets',
        });
      }
    }

    const maxLazy = num(ctx, 'maxLazyChunkKb', 250) * KB;
    for (const chunk of lazy.filter((f) => f.bytes > maxLazy).sort((a, b) => b.bytes - a.bytes)) {
      findings.push({
        severity: 'low',
        ruleId: 'large-lazy-chunk',
        message: `Lazy chunk ${chunk.name} is ${formatKb(chunk.bytes)} (limit ${formatKb(maxLazy)}).`,
        fixHint: 'Split the feature further or @defer heavy, below-the-fold parts.',
      });
    }

    // Score: initial size relative to the initial budget (100 at/below warning, 50 at error,
    // 0 at twice the error limit), minus 3 points per other finding.
    const initialBudget = budgets.find((b) => b.type === 'initial');
    const warn = parseSize(initialBudget?.maximumWarning) ?? 500 * KB;
    const err = parseSize(initialBudget?.maximumError) ?? 1024 * KB;
    const sizeScore =
      initialBytes <= warn
        ? 100
        : initialBytes <= err
          ? 100 - (50 * (initialBytes - warn)) / Math.max(1, err - warn)
          : 50 - (50 * (initialBytes - err)) / err;
    const otherFindings = findings.filter(
      (f) => !(f.ruleId?.startsWith('budget-') && f.message.startsWith('Initial')),
    ).length;

    const meta: BundleMeta = {
      outputDir: outputPath,
      built,
      initialBytes,
      initialKb: Math.round((initialBytes / KB) * 10) / 10,
      initialGzipBytes,
      lazyBytes: sum(lazy),
      totalBytes: sum(files),
      initialFiles: initial
        .map(({ name, bytes }) => ({ name, bytes }))
        .sort((a, b) => b.bytes - a.bytes),
      largestLazyChunks: lazy
        .map(({ name, bytes }) => ({ name, bytes }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 10),
      topModules: stats ? topModules(stats) : [],
      statsSource,
      budgets: budgetResults,
    };
    return { score: clampScore(sizeScore - 3 * otherFindings), findings, meta };
  },
});
