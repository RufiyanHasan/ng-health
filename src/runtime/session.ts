import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../core/errors.js';
import { pathExists } from '../core/fs.js';
import { skipCheck, type CheckContext } from '../core/types.js';
import { resolveBuildOutput } from '../checks/bundle/output.js';
import { CHROME_HELP, chromeFlags, findChrome } from './chrome.js';
import { serveStatic } from './server.js';

/** The subset of a Lighthouse result (LHR) that ng-health reads. */
export interface LighthouseResult {
  categories: Record<
    string,
    { score: number | null; auditRefs: { id: string; weight: number; group?: string }[] }
  >;
  audits: Record<
    string,
    {
      id: string;
      title: string;
      description: string;
      score: number | null;
      scoreDisplayMode: string;
      displayValue?: string;
      numericValue?: number;
      details?: { overallSavingsMs?: number; overallSavingsBytes?: number };
      metricSavings?: Record<string, number>;
    }
  >;
  runtimeError?: { code: string; message: string };
}

/** The subset of axe-core results that ng-health reads. */
export interface AxeResult {
  violations: {
    id: string;
    impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
    help: string;
    description: string;
    helpUrl: string;
    nodes: { target: unknown[]; failureSummary?: string }[];
  }[];
}

export interface RuntimeSession {
  baseUrl: string;
  source: 'url' | 'local-build';
  authenticated: boolean;
  lighthouse(url: string): Promise<LighthouseResult>;
  axe(url: string): Promise<AxeResult>;
}

/** Arguments passed to a login script's default export. */
export interface LoginScriptArgs {
  /** A Playwright Page in the browser context that Lighthouse and axe will use. */
  page: import('playwright-core').Page;
  context: import('playwright-core').BrowserContext;
  /** Base URL of the audited app, without a trailing slash. */
  baseUrl: string;
  routes: string[];
}

export const RUNTIME_PACKAGES = [
  'lighthouse',
  'chrome-launcher',
  'playwright-core',
  '@axe-core/playwright',
];

/** Shared by all runtime checks: one server, one browser, one login per audit. */
export function getRuntimeSession(ctx: CheckContext): Promise<RuntimeSession> {
  return ctx.shared('runtime-session', () => openSession(ctx));
}

export function routeUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/$/, '')}${route}`;
}

async function loadLibraries() {
  try {
    const [lighthouse, desktop, chromeLauncher, playwright, axe] = await Promise.all([
      import('lighthouse'),
      import('lighthouse/core/config/desktop-config.js'),
      import('chrome-launcher'),
      import('playwright-core'),
      import('@axe-core/playwright'),
    ]);
    return {
      ok: true as const,
      lighthouse: lighthouse.default,
      desktopConfig: desktop.default,
      chromeLauncher,
      chromium: playwright.chromium,
      AxeBuilder: axe.AxeBuilder,
    };
  } catch (err) {
    return { ok: false as const, error: errorMessage(err) };
  }
}

async function resolveTarget(
  ctx: CheckContext,
): Promise<{ baseUrl: string; source: RuntimeSession['source'] }> {
  if (ctx.runtime.url) return { baseUrl: ctx.runtime.url.replace(/\/$/, ''), source: 'url' };
  const output = await resolveBuildOutput(ctx);
  if (!output) skipCheck('No application to serve: pass --url to audit a running app');
  let index: string | undefined;
  for (const candidate of ['index.html', 'index.csr.html']) {
    if (await pathExists(path.join(output.browserDir, candidate))) {
      index = candidate;
      break;
    }
  }
  if (!index) {
    skipCheck(
      `No build output to serve in ${output.outputPath}: build the app first, or pass --url`,
    );
  }
  const server = await serveStatic(output.browserDir, index);
  ctx.onCleanup(() => server.close());
  ctx.logger.debug(`Serving ${output.outputPath} at ${server.url}`);
  return { baseUrl: server.url, source: 'local-build' };
}

async function openSession(ctx: CheckContext): Promise<RuntimeSession> {
  const libs = await loadLibraries();
  if (!libs.ok) {
    ctx.logger.debug(`Runtime libraries failed to load: ${libs.error}`);
    skipCheck(
      `Runtime checks need the optional packages ${RUNTIME_PACKAGES.join(', ')} (npm i -D ${RUNTIME_PACKAGES.join(' ')})`,
    );
  }
  const chromePath = await findChrome(ctx.runtime.chromePath);
  if (!chromePath) skipCheck(`Chromium not available. ${CHROME_HELP}`);

  const target = await resolveTarget(ctx);

  let chrome: Awaited<ReturnType<typeof libs.chromeLauncher.launch>>;
  try {
    chrome = await libs.chromeLauncher.launch({
      chromePath,
      chromeFlags: chromeFlags(),
      logLevel: 'silent',
      // The CLI handles SIGINT/SIGTERM itself and disposes Chrome along with everything else.
      handleSIGINT: false,
    });
  } catch (err) {
    skipCheck(`Chromium failed to start (${errorMessage(err)}). ${CHROME_HELP}`);
  }
  ctx.onCleanup(() => chrome.kill());
  ctx.logger.debug(`Chrome ${chromePath} listening on port ${chrome.port}`);

  // Playwright attaches to the same browser, so a login performed here is visible to Lighthouse.
  const browser = await libs.chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  ctx.onCleanup(() => browser.close());
  const context = browser.contexts()[0] ?? (await browser.newContext());

  let authenticated = false;
  if (ctx.runtime.loginScript) {
    const page = await context.newPage();
    try {
      const mod = (await import(pathToFileURL(ctx.runtime.loginScript).href)) as {
        default?: (args: LoginScriptArgs) => Promise<void> | void;
      };
      if (typeof mod.default !== 'function')
        throw new Error('it must export a default async function');
      await mod.default({ page, context, baseUrl: target.baseUrl, routes: ctx.runtime.routes });
      authenticated = true;
      ctx.logger.debug('Login script completed');
    } catch (err) {
      throw new Error(
        `Login script ${path.basename(ctx.runtime.loginScript)} failed: ${errorMessage(err)}`,
        {
          cause: err,
        },
      );
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    ...target,
    authenticated,
    async lighthouse(url) {
      const result = await libs.lighthouse(
        url,
        {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          // Lighthouse clears the origin's storage by default, which would log the user out.
          disableStorageReset: authenticated,
        },
        ctx.runtime.formFactor === 'desktop' ? libs.desktopConfig : undefined,
      );
      if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
      return result.lhr as unknown as LighthouseResult;
    },
    async axe(url) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
        return (await new libs.AxeBuilder({ page })
          .withTags(ctx.runtime.axeTags)
          .analyze()) as AxeResult;
      } finally {
        await page.close().catch(() => {});
      }
    },
  };
}
