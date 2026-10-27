import { existsSync } from 'node:fs';

/**
 * Finds a Chrome/Chromium executable: explicit config, NG_HEALTH_CHROME_PATH/CHROME_PATH,
 * installed Chrome (chrome-launcher's detection), then Playwright's downloaded Chromium.
 */
export async function findChrome(configured?: string): Promise<string | undefined> {
  const explicit = configured ?? process.env['NG_HEALTH_CHROME_PATH'] ?? process.env['CHROME_PATH'];
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  try {
    const { Launcher } = await import('chrome-launcher');
    const found = Launcher.getInstallations().find((p) => existsSync(p));
    if (found) return found;
  } catch {
    // chrome-launcher not installed or detection failed; try Playwright next
  }
  try {
    const { chromium } = await import('playwright-core');
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // playwright-core not installed
  }
  return undefined;
}

export const CHROME_HELP =
  'Install Google Chrome, run "npx playwright install chromium", or set CHROME_PATH (or runtime.chromePath in the config).';

/** Flags for headless Chrome in CI containers (no sandbox when running as root). */
export function chromeFlags(): string[] {
  const flags = [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) flags.push('--no-sandbox');
  return flags;
}
